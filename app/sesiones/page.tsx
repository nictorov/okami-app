'use client'
// "Sesiones": las sesiones agendadas de los proyectos.
// El día de la sesión el tatuador asocia el consentimiento firmado por el
// cliente (los datos oficiales sobreescriben los provisorios), imprime y
// firma, y luego cierra la sesión (completada / incompleta / cancelada).
// Reglas 24h: asociado sin firmar → cancelada; firmado sin cierre → completada.
import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import {
  Sesion, SesionEstado, SESION_ESTADO_LABEL, Proyecto, Cliente, Tatuador,
  Consentimiento, formatCLP, formatRut,
} from '@/lib/types'
import { useSesion } from '@/lib/sesion'
import {
  aplicarReglas24h, asociarConsentimiento, desasociarConsentimiento, marcarSesionFirmada,
} from '@/lib/sesiones'
import { generarPDFConsentimiento } from '@/lib/pdf'
import { ModalImprimirFirmar } from '@/components/consent-ui'
import { MoneyCell } from '@/components/money'

type SesionFull = Sesion & {
  proyecto: (Proyecto & { cliente: Cliente | null }) | null
}

const PILL_ESTADO: Record<SesionEstado, string> = {
  espera_consentimiento: 'alerta',
  consentimiento_firmado: 'ok',
  completada: 'ok',
  incompleta: 'alerta',
  cancelada: 'peligro',
}

type Tab = 'hoy' | 'proximas' | 'historial'

function hoyISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function SesionesPage() {
  const { sesion } = useSesion()
  const esTatuador = sesion?.rol === 'tatuador'
  const esHost = sesion?.rol === 'host'
  const miId = sesion?.tatuadorId ?? null

  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('hoy')
  const [mes, setMes] = useState(hoyISO().slice(0, 7))
  const [sesiones, setSesiones] = useState<SesionFull[]>([])
  const [tatuadores, setTatuadores] = useState<Tatuador[]>([])

  // Consentimientos disponibles por sesión abierta
  const [viendoCons, setViendoCons] = useState<string | null>(null)
  const [consDisponibles, setConsDisponibles] = useState<Consentimiento[]>([])
  const [cargandoCons, setCargandoCons] = useState(false)

  // Imprimir y firmar
  const [modalSesion, setModalSesion] = useState<SesionFull | null>(null)

  // Cierre con observación
  const [cerrando, setCerrando] = useState<{ id: string; estado: 'incompleta' | 'cancelada' } | null>(null)
  const [observacion, setObservacion] = useState('')

  const cargar = useCallback(async () => {
    setLoading(true)
    let q = supabase.from('sesiones')
      .select('*, proyecto:proyectos(*, cliente:clientes(*))')
    const hoy = hoyISO()
    if (tab === 'hoy') {
      q = q.gte('inicio', `${hoy}T00:00:00`).lte('inicio', `${hoy}T23:59:59`)
        .order('inicio', { ascending: true })
    } else if (tab === 'proximas') {
      q = q.gt('inicio', `${hoy}T23:59:59`)
        .in('estado', ['espera_consentimiento'])
        .order('inicio', { ascending: true }).limit(100)
    } else {
      const [anio, mesNum] = mes.split('-').map(Number)
      const hasta = new Date(anio, mesNum, 1).toISOString()
      q = q.gte('inicio', `${mes}-01T00:00:00`).lt('inicio', hasta)
        .order('inicio', { ascending: false })
    }
    if (esTatuador && miId) q = q.eq('tatuador_id', miId)
    const [s, t] = await Promise.all([
      q,
      supabase.from('tatuadores').select('*').eq('activo', true),
    ])
    const conReglas = await aplicarReglas24h((s.data as SesionFull[]) ?? [])
    setSesiones(conReglas)
    setTatuadores((t.data ?? []).filter((x: Tatuador) => !x.archivado && !x.eliminado))
    setLoading(false)
  }, [tab, mes, esTatuador, miId])

  useEffect(() => { cargar() }, [cargar])

  // Consentimientos activos asignados al tatuador de la sesión
  // (pendientes de las últimas 48 h, no asociados ya a otra sesión)
  async function verConsentimientos(s: SesionFull) {
    if (viendoCons === s.id) { setViendoCons(null); return }
    setViendoCons(s.id)
    setCargandoCons(true)
    const tat = tatuadores.find(t => t.id === s.tatuador_id)
    const hace48 = new Date(Date.now() - 48 * 3600 * 1000).toISOString()
    let query = supabase.from('consentimientos')
      .select('*').eq('estado', 'pendiente').gte('created_at', hace48)
      .order('created_at', { ascending: false }).limit(30)
    if (tat) query = query.eq('tatuador', tat.nombre)
    const { data: cons } = await query
    // Excluir los ya asociados a alguna sesión
    const ids = (cons ?? []).map(c => c.id)
    let ocupados = new Set<string>()
    if (ids.length) {
      const { data: usados } = await supabase.from('sesiones')
        .select('consentimiento_id').in('consentimiento_id', ids)
      ocupados = new Set((usados ?? []).map(x => x.consentimiento_id))
    }
    setConsDisponibles(((cons ?? []) as Consentimiento[]).filter(c => !ocupados.has(c.id!)))
    setCargandoCons(false)
  }

  async function asociar(s: SesionFull, cons: Consentimiento) {
    const { error } = await asociarConsentimiento(s, cons)
    if (error) { alert('Error al asociar: ' + error); return }
    setViendoCons(null)
    cargar()
  }

  async function desasociar(s: SesionFull) {
    if (s.consentimiento_firmado_en) { alert('El consentimiento ya fue impreso y firmado: no se puede desasociar.'); return }
    await desasociarConsentimiento(s)
    cargar()
  }

  // Imprimir y firmar (mismo flujo del módulo de consentimiento)
  async function confirmarImprimir() {
    const s = modalSesion
    if (!s?.consentimiento_id) return
    setModalSesion(null)
    const { data: cons } = await supabase.from('consentimientos')
      .select('*').eq('id', s.consentimiento_id).single()
    if (!cons) return
    // Enriquecer con datos del tatuador para el PDF
    const { data: tat } = await supabase.from('tatuadores')
      .select('nombre, rut, nacimiento, telefono').eq('id', s.tatuador_id).single()
    generarPDFConsentimiento({
      ...cons,
      tatuador_datos: tat ? {
        nombre: tat.nombre, rut: tat.rut ?? '—',
        nac: tat.nacimiento ?? '', tel: tat.telefono ?? '',
      } : cons.tatuador_datos,
    })
    const ahora = new Date().toISOString()
    await supabase.from('consentimientos').update({
      estado: 'firmado', impreso_en: ahora, firmado_en: ahora,
    }).eq('id', s.consentimiento_id)
    await marcarSesionFirmada(s.id)
    cargar()
  }

  async function actualizarSesion(id: string, cambios: Partial<Sesion>) {
    setSesiones(ss => ss.map(x => x.id === id ? { ...x, ...cambios } : x))
    await supabase.from('sesiones')
      .update({ ...cambios, updated_at: new Date().toISOString() }).eq('id', id)
  }

  function cerrarSesion(id: string, estado: 'completada' | 'incompleta' | 'cancelada') {
    if (estado === 'completada') {
      actualizarSesion(id, { estado })
    } else {
      setCerrando({ id, estado })
      setObservacion('')
    }
  }

  function nombreTat(id: string): string {
    const t = tatuadores.find(x => x.id === id)
    return t ? (t.nombre_artistico || t.nombre) : '?'
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 18 }}>
        <h1>Sesiones</h1>
        {(['hoy', 'proximas', 'historial'] as Tab[]).map(x => (
          <button key={x} className={`chico ${tab === x ? '' : 'secundario'}`} onClick={() => setTab(x)}>
            {x === 'hoy' ? 'Hoy' : x === 'proximas' ? 'Próximas' : 'Historial'}
          </button>
        ))}
        {tab === 'historial' && (
          <input type="month" value={mes} onChange={e => e.target.value && setMes(e.target.value)}
            style={{ width: 160 }} />
        )}
      </div>

      {loading ? <div className="spinner" /> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {sesiones.map(s => (
            <div key={s.id} className="card" style={{ padding: 14 }}>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 6 }}>
                <strong>
                  {new Date(s.inicio).toLocaleDateString('es-CL', { weekday: 'short', day: '2-digit', month: 'short' })}
                  {' '}{new Date(s.inicio).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}
                </strong>
                <span className={`pill ${PILL_ESTADO[s.estado]}`}>{SESION_ESTADO_LABEL[s.estado]}</span>
                <span>{s.proyecto?.cliente?.nombre ?? '—'}</span>
                {!esTatuador && <span className="pill">{nombreTat(s.tatuador_id)}</span>}
                <span className="pill">Sesión {s.numero}</span>
                {s.proyecto && <span className="folio-badge">{s.proyecto.folio}</span>}
                {!esHost && <strong style={{ marginLeft: 'auto' }}>{formatCLP(s.valor)}</strong>}
              </div>

              {s.proyecto?.descripcion && (
                <p style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 8 }}>{s.proyecto.descripcion}</p>
              )}

              {/* Valor y abono editables */}
              {!esHost && (
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8, fontSize: 13 }}>
                  <span style={{ color: 'var(--text2)' }}>Valor:</span>
                  <MoneyCell initial={s.valor} onCommit={v => actualizarSesion(s.id, { valor: v })} />
                  <span style={{ color: 'var(--text2)' }}>Abono:</span>
                  <MoneyCell initial={s.abono} onCommit={v => actualizarSesion(s.id, { abono: v })} />
                  <label style={{ display: 'flex', alignItems: 'center', gap: 5, margin: 0, cursor: 'pointer', color: 'var(--text)', fontSize: 13 }}>
                    <input type="checkbox" checked={s.abonado} style={{ width: 'auto' }}
                      onChange={e => actualizarSesion(s.id, { abonado: e.target.checked })} />
                    Abonado
                  </label>
                </div>
              )}

              {/* Consentimiento */}
              {s.estado === 'espera_consentimiento' && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  {s.consentimiento_id ? (
                    <>
                      <span className="pill ok">Consentimiento asociado ✓</span>
                      <button className="chico" onClick={() => setModalSesion(s)}>🖨 Imprimir y firmar</button>
                      <button className="chico secundario" onClick={() => desasociar(s)}>Desasociar</button>
                    </>
                  ) : (
                    <button className="chico" onClick={() => verConsentimientos(s)}>
                      ✍ Consentimientos disponibles
                    </button>
                  )}
                </div>
              )}

              {/* Lista de consentimientos disponibles */}
              {viendoCons === s.id && !s.consentimiento_id && (
                <div style={{ marginTop: 10, borderTop: '0.5px solid var(--border)', paddingTop: 10 }}>
                  {cargandoCons ? <div className="spinner" /> : consDisponibles.length === 0 ? (
                    <p style={{ color: 'var(--text3)', fontSize: 13 }}>
                      No hay consentimientos activos asignados a {esTatuador ? 'tu cuenta' : 'este tatuador'}.
                      El cliente debe completar primero su consentimiento indicando al tatuador.
                    </p>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {consDisponibles.map(c => (
                        <div key={c.id} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 13 }}>
                          <button className="chico" onClick={() => asociar(s, c)}>Asociar</button>
                          <span className="folio-badge">{c.folio}</span>
                          <span>{c.nombre}</span>
                          <span style={{ color: 'var(--text3)' }}>{formatRut(c.rut)}</span>
                          {c.menor && <span className="tag menor">Menor</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Cierre tras firma */}
              {s.estado === 'consentimiento_firmado' && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 4 }}>
                  <span style={{ fontSize: 12, color: 'var(--text3)' }}>
                    ¿Cómo terminó la sesión? (si no eliges en 24 h queda completada)
                  </span>
                  <button className="chico" onClick={() => cerrarSesion(s.id, 'completada')}>✓ Completada</button>
                  <button className="chico secundario" onClick={() => cerrarSesion(s.id, 'incompleta')}>Incompleta</button>
                  <button className="chico secundario" onClick={() => cerrarSesion(s.id, 'cancelada')}>Cancelada</button>
                </div>
              )}

              {cerrando?.id === s.id && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 8 }}>
                  <input value={observacion} placeholder="Observación (opcional)"
                    onChange={e => setObservacion(e.target.value)} style={{ width: 260 }} />
                  <button className="chico" onClick={() => {
                    actualizarSesion(cerrando.id, { estado: cerrando.estado, observacion: observacion.trim() || null })
                    setCerrando(null)
                  }}>Confirmar {cerrando.estado}</button>
                  <button className="chico secundario" onClick={() => setCerrando(null)}>✕</button>
                </div>
              )}

              {['incompleta', 'cancelada'].includes(s.estado) && s.observacion && (
                <p style={{ fontSize: 12, color: 'var(--text3)', marginTop: 4 }}>Obs: {s.observacion}</p>
              )}
            </div>
          ))}
          {sesiones.length === 0 && (
            <div className="vacio">
              {tab === 'hoy' ? 'Sin sesiones para hoy.' : tab === 'proximas' ? 'Sin sesiones futuras agendadas.' : 'Sin sesiones este mes.'}
            </div>
          )}
        </div>
      )}

      {modalSesion && (
        <ModalImprimirFirmar
          folio={modalSesion.proyecto?.folio ?? ''}
          onAceptar={confirmarImprimir}
          onCancelar={() => setModalSesion(null)}
        />
      )}
    </div>
  )
}
