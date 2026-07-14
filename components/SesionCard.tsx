'use client'
// Tarjeta de sesión con toda su gestión: el flujo completo del
// consentimiento del tatuador embebido (lista desplegada de disponibles,
// selección, datos del trabajo prellenados desde el proyecto, editar,
// imprimir y firmar), valor/abono editables y cierre de la sesión.
// Usada en Mis tatuajes/Registro y en Calendario.
import { useEffect, useState, useCallback } from 'react'
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

// Tipos de tatuaje del módulo de consentimiento original
const TIPOS = ['Realismo', 'Blackwork', 'Neotradicional', 'Tradicional', 'Japonés', 'Acuarela', 'Geométrico', 'Lettering', 'Tribal', 'Fine line', 'Cover', 'Otro']

export default function SesionCard({ s, tatuadores, onChanged }: {
  s: SesionFull
  tatuadores: Tatuador[]
  onChanged: () => void
}) {
  const { sesion } = useSesion()
  const esTatuador = sesion?.rol === 'tatuador'
  const esHost = sesion?.rol === 'host'

  const [consDisponibles, setConsDisponibles] = useState<Consentimiento[] | null>(null)
  const [consRow, setConsRow] = useState<Consentimiento | null>(null)
  const [work, setWork] = useState<{ desc: string; zona: string; tipo: string; med: string } | null>(null)
  const [med, setMed] = useState('')
  const [modal, setModal] = useState(false)
  const [cerrando, setCerrando] = useState<'incompleta' | 'cancelada' | null>(null)
  const [observacion, setObservacion] = useState('')

  const esperaSinCons = s.estado === 'espera_consentimiento' && !s.consentimiento_id
  const esperaConCons = s.estado === 'espera_consentimiento' && !!s.consentimiento_id

  function nombreTat(id: string): string {
    const t = tatuadores.find(x => x.id === id)
    return t ? (t.nombre_artistico || t.nombre) : '?'
  }

  async function actualizar(cambios: Partial<Sesion>) {
    await supabase.from('sesiones')
      .update({ ...cambios, updated_at: new Date().toISOString() }).eq('id', s.id)
    onChanged()
  }

  // ── Consentimientos disponibles: cargados y desplegados automáticamente ──
  const cargarDisponibles = useCallback(async () => {
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
  }, [s.tatuador_id, tatuadores])

  useEffect(() => {
    if (esperaSinCons && tatuadores.length > 0) cargarDisponibles()
  }, [esperaSinCons, tatuadores.length, cargarDisponibles])

  // ── Consentimiento asociado: cargar su estado (datos del trabajo) ──
  useEffect(() => {
    if (!esperaConCons || !s.consentimiento_id) { setConsRow(null); setWork(null); return }
    let cancelado = false
    supabase.from('consentimientos').select('*').eq('id', s.consentimiento_id).single()
      .then(async ({ data }) => {
        if (cancelado || !data) return
        setConsRow(data as Consentimiento)
        setMed(data.condiciones_medicas ?? '')
        // Si aún no tiene los datos del trabajo, abrir el formulario
        // prellenado desde el proyecto agendado
        if (!data.work_filled) {
          let tipoPre = data.tipo_tatuaje ?? ''
          if (!tipoPre && s.proyecto?.estilo_id) {
            const { data: est } = await supabase.from('estilos')
              .select('nombre').eq('id', s.proyecto.estilo_id).single()
            tipoPre = est?.nombre ?? ''
          }
          if (!cancelado) {
            setWork({
              desc: data.descripcion ?? s.proyecto?.descripcion ?? '',
              zona: data.zona ?? s.proyecto?.zona ?? '',
              tipo: tipoPre,
              med: data.condiciones_medicas ?? '',
            })
          }
        }
      })
    return () => { cancelado = true }
  }, [esperaConCons, s.consentimiento_id, s.proyecto])

  async function seleccionar(cons: Consentimiento) {
    const { error } = await asociarConsentimiento(s, cons)
    if (error) { alert('Error al asociar: ' + error); return }
    onChanged()
  }

  // Condiciones médicas: editable desde el principio, independiente del
  // resto del formulario (pueden cambiar sesión a sesión)
  async function guardarMed(valor: string) {
    if (!s.consentimiento_id || valor === (consRow?.condiciones_medicas ?? '')) return
    await supabase.from('consentimientos')
      .update({ condiciones_medicas: valor.trim() || null }).eq('id', s.consentimiento_id)
    setConsRow(prev => prev ? { ...prev, condiciones_medicas: valor.trim() || undefined } : prev)
  }

  async function desasociar() {
    if (s.consentimiento_firmado_en) { alert('El consentimiento ya fue impreso y firmado: no se puede desasociar.'); return }
    await desasociarConsentimiento(s)
    onChanged()
  }

  async function guardarWork() {
    if (!work || !s.consentimiento_id) return
    if (!work.desc.trim()) { alert('La descripción del tatuaje es obligatoria.'); return }
    if (!work.zona.trim()) { alert('La zona del cuerpo es obligatoria.'); return }
    await supabase.from('consentimientos').update({
      descripcion: work.desc.trim(),
      zona: work.zona.trim(),
      tipo_tatuaje: work.tipo || null,
      condiciones_medicas: work.med.trim() || null,
      work_filled: true,
    }).eq('id', s.consentimiento_id)
    setWork(null)
    setConsRow(prev => prev ? {
      ...prev, work_filled: true,
      descripcion: work.desc.trim(), zona: work.zona.trim(),
      tipo_tatuaje: work.tipo || undefined, condiciones_medicas: work.med.trim() || undefined,
    } : prev)
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

      {/* ── Consentimientos disponibles (desplegados automáticamente) ── */}
      {esperaSinCons && (
        <div style={{ marginTop: 4, borderTop: '0.5px solid var(--border)', paddingTop: 10 }}>
          <div className="section-title" style={{ marginBottom: 8 }}>Consentimientos disponibles</div>
          {consDisponibles === null ? <div className="spinner" /> : consDisponibles.length === 0 ? (
            <p style={{ color: 'var(--text3)', fontSize: 13, marginBottom: 8 }}>
              No hay consentimientos activos asignados a {esTatuador ? 'tu cuenta' : 'este tatuador'}.
              El cliente debe completar primero su consentimiento indicando al tatuador.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
              {consDisponibles.map(c => (
                <div key={c.id} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 13 }}>
                  <button className="chico" onClick={() => seleccionar(c)}>Seleccionar</button>
                  <span className="folio-badge">{c.folio}</span>
                  <span>{c.nombre}</span>
                  <span style={{ color: 'var(--text3)' }}>{formatRut(c.rut)}</span>
                  {c.menor && <span className="tag menor">Menor</span>}
                </div>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button className="chico secundario" onClick={cargarDisponibles}>↻ Actualizar</button>
            <button className="chico secundario" onClick={() => { setCerrando('cancelada'); setObservacion('') }}>
              Cancelar sesión
            </button>
          </div>
        </div>
      )}

      {/* ── Consentimiento asociado: datos del trabajo + imprimir/firmar ── */}
      {esperaConCons && consRow && (
        <div style={{ marginTop: 4, borderTop: '0.5px solid var(--border)', paddingTop: 10 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
            <span className="pill ok">Consentimiento {consRow.folio} · {consRow.nombre}</span>
            {consRow.menor && <span className="tag menor">Menor de edad</span>}
          </div>

          {work ? (
            <>
              <div className="banner info">Confirma los datos del trabajo (prellenados desde el tatuaje agendado).</div>
              <label>Descripción del tatuaje *</label>
              <input value={work.desc} onChange={e => setWork({ ...work, desc: e.target.value })} />
              <label style={{ marginTop: 10 }}>Zona del cuerpo *</label>
              <input value={work.zona} onChange={e => setWork({ ...work, zona: e.target.value })} />
              <label style={{ marginTop: 10 }}>Tipo de tatuaje</label>
              <select value={work.tipo} onChange={e => setWork({ ...work, tipo: e.target.value })}>
                <option value="">Selecciona...</option>
                {work.tipo && !TIPOS.includes(work.tipo) && <option value={work.tipo}>{work.tipo}</option>}
                {TIPOS.map(t => <option key={t}>{t}</option>)}
              </select>
              <label style={{ marginTop: 10 }}>Condiciones médicas y comentarios</label>
              <textarea rows={2} value={work.med} placeholder="Sin condiciones / alergias / etc."
                onChange={e => setWork({ ...work, med: e.target.value })} />
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <button className="chico" onClick={guardarWork}>Guardar datos del trabajo</button>
                <button className="chico secundario" onClick={desasociar}>Volver atrás</button>
              </div>
            </>
          ) : consRow.work_filled ? (
            <>
              <div style={{ background: 'var(--bg2)', borderRadius: 8, padding: 12, fontSize: 12, marginBottom: 8 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                  <div><span style={{ color: 'var(--text2)' }}>Descripción:</span> {consRow.descripcion}</div>
                  <div><span style={{ color: 'var(--text2)' }}>Zona:</span> {consRow.zona}</div>
                  <div><span style={{ color: 'var(--text2)' }}>Tipo:</span> {consRow.tipo_tatuaje || '—'}</div>
                </div>
              </div>
              <label>Condiciones médicas y comentarios</label>
              <textarea rows={2} value={med} placeholder="Sin condiciones / alergias / etc."
                onChange={e => setMed(e.target.value)}
                onBlur={e => guardarMed(e.target.value)} />
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                <button className="chico secundario" onClick={() => setWork({
                  desc: consRow.descripcion ?? '', zona: consRow.zona ?? '',
                  tipo: consRow.tipo_tatuaje ?? '', med,
                })}>Editar</button>
                <button className="chico" onClick={() => setModal(true)}>🖨 Imprimir y firmar</button>
                <button className="chico secundario" onClick={desasociar}>Volver atrás</button>
              </div>
            </>
          ) : <div className="spinner" />}

          <div style={{ marginTop: 8 }}>
            <button className="chico secundario" onClick={() => { setCerrando('cancelada'); setObservacion('') }}>
              Cancelar sesión
            </button>
          </div>
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
          folio={consRow?.folio ?? s.proyecto?.folio ?? ''}
          onAceptar={confirmarImprimir}
          onCancelar={() => setModal(false)}
        />
      )}
    </div>
  )
}
