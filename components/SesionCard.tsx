'use client'
// Tarjeta de sesión con toda su gestión: asociar/desasociar consentimiento,
// imprimir y firmar, valor/abono editables y cierre (completada /
// incompleta / cancelada). Usada en Mis tatuajes/Registro y en Calendario.
import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import {
  Sesion, SesionEstado, SESION_ESTADO_LABEL, Proyecto, Cliente, Tatuador,
  Consentimiento, formatCLP, formatRut,
} from '@/lib/types'
import { useSesion } from '@/lib/sesion'
import {
  asociarConsentimiento, desasociarConsentimiento, marcarSesionFirmada,
} from '@/lib/sesiones'
import { generarPDFConsentimiento } from '@/lib/pdf'
import { ModalImprimirFirmar } from '@/components/consent-ui'
import { MoneyCell } from '@/components/money'

export type SesionFull = Sesion & {
  proyecto: (Proyecto & { cliente: Cliente | null }) | null
}

const PILL_ESTADO: Record<SesionEstado, string> = {
  espera_consentimiento: 'alerta',
  consentimiento_firmado: 'ok',
  completada: 'ok',
  incompleta: 'alerta',
  cancelada: 'peligro',
}

export default function SesionCard({ s, tatuadores, onChanged }: {
  s: SesionFull
  tatuadores: Tatuador[]
  onChanged: () => void
}) {
  const { sesion } = useSesion()
  const esTatuador = sesion?.rol === 'tatuador'
  const esHost = sesion?.rol === 'host'

  const [viendoCons, setViendoCons] = useState(false)
  const [consDisponibles, setConsDisponibles] = useState<Consentimiento[]>([])
  const [cargandoCons, setCargandoCons] = useState(false)
  const [modal, setModal] = useState(false)
  const [cerrando, setCerrando] = useState<'incompleta' | 'cancelada' | null>(null)
  const [observacion, setObservacion] = useState('')

  function nombreTat(id: string): string {
    const t = tatuadores.find(x => x.id === id)
    return t ? (t.nombre_artistico || t.nombre) : '?'
  }

  async function actualizar(cambios: Partial<Sesion>) {
    await supabase.from('sesiones')
      .update({ ...cambios, updated_at: new Date().toISOString() }).eq('id', s.id)
    onChanged()
  }

  // Consentimientos activos asignados al tatuador de la sesión
  // (pendientes de las últimas 48 h, no asociados ya a otra sesión)
  async function verConsentimientos() {
    if (viendoCons) { setViendoCons(false); return }
    setViendoCons(true)
    setCargandoCons(true)
    const tat = tatuadores.find(t => t.id === s.tatuador_id)
    const hace48 = new Date(Date.now() - 48 * 3600 * 1000).toISOString()
    let query = supabase.from('consentimientos')
      .select('*').eq('estado', 'pendiente').gte('created_at', hace48)
      .order('created_at', { ascending: false }).limit(30)
    if (tat) query = query.eq('tatuador', tat.nombre)
    const { data: cons } = await query
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

  async function asociar(cons: Consentimiento) {
    const { error } = await asociarConsentimiento(s, cons)
    if (error) { alert('Error al asociar: ' + error); return }
    setViendoCons(false)
    onChanged()
  }

  async function desasociar() {
    if (s.consentimiento_firmado_en) { alert('El consentimiento ya fue impreso y firmado: no se puede desasociar.'); return }
    await desasociarConsentimiento(s)
    onChanged()
  }

  async function confirmarImprimir() {
    if (!s.consentimiento_id) return
    setModal(false)
    const { data: cons } = await supabase.from('consentimientos')
      .select('*').eq('id', s.consentimiento_id).single()
    if (!cons) return
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
    onChanged()
  }

  function cerrar(estado: 'completada' | 'incompleta' | 'cancelada') {
    if (estado === 'completada') actualizar({ estado })
    else { setCerrando(estado); setObservacion('') }
  }

  return (
    <div className="card" style={{ padding: 14 }}>
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
          <MoneyCell initial={s.valor} onCommit={v => actualizar({ valor: v })} />
          <span style={{ color: 'var(--text2)' }}>Abono:</span>
          <MoneyCell initial={s.abono} onCommit={v => actualizar({ abono: v })} />
          <label style={{ display: 'flex', alignItems: 'center', gap: 5, margin: 0, cursor: 'pointer', color: 'var(--text)', fontSize: 13 }}>
            <input type="checkbox" checked={s.abonado} style={{ width: 'auto' }}
              onChange={e => actualizar({ abonado: e.target.checked })} />
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
              <button className="chico" onClick={() => setModal(true)}>🖨 Imprimir y firmar</button>
              <button className="chico secundario" onClick={desasociar}>Desasociar</button>
            </>
          ) : (
            <button className="chico" onClick={verConsentimientos}>
              ✍ Consentimientos disponibles
            </button>
          )}
          <button className="chico secundario" onClick={() => { setCerrando('cancelada'); setObservacion('') }}>
            Cancelar sesión
          </button>
        </div>
      )}

      {viendoCons && !s.consentimiento_id && (
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
                  <button className="chico" onClick={() => asociar(c)}>Asociar</button>
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
          <button className="chico" onClick={() => cerrar('completada')}>✓ Completada</button>
          <button className="chico secundario" onClick={() => cerrar('incompleta')}>Incompleta</button>
          <button className="chico secundario" onClick={() => cerrar('cancelada')}>Cancelada</button>
        </div>
      )}

      {cerrando && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 8 }}>
          <input value={observacion} placeholder="Observación (opcional)"
            onChange={e => setObservacion(e.target.value)} style={{ width: 260 }} />
          <button className="chico" onClick={() => {
            actualizar({ estado: cerrando, observacion: observacion.trim() || null })
            setCerrando(null)
          }}>Confirmar {cerrando}</button>
          <button className="chico secundario" onClick={() => setCerrando(null)}>✕</button>
        </div>
      )}

      {['incompleta', 'cancelada'].includes(s.estado) && s.observacion && (
        <p style={{ fontSize: 12, color: 'var(--text3)', marginTop: 4 }}>Obs: {s.observacion}</p>
      )}

      {modal && (
        <ModalImprimirFirmar
          folio={s.proyecto?.folio ?? ''}
          onAceptar={confirmarImprimir}
          onCancelar={() => setModal(false)}
        />
      )}
    </div>
  )
}
