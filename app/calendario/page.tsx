'use client'
// Calendario de disponibilidad y reservas por puesto.
//  * Full: ve solo el calendario de su puesto (siempre disponible para él).
//  * Compartido: ve el calendario de su puesto; los días de su compañero
//    aparecen como "Ocupado" sin detalle. Reserva días libres.
//  * Rotativo/Guest: un solo calendario con cupos "Día 1..n" (n = puestos
//    rotativos activos); al reservar se elige el cupo, que queda bloqueado.
//  * Fines de semana: turnos AM y PM; se pueden reservar ambos (día
//    completo, de mayor valor) si no hay tope.
//  * Cancelación: hasta el mismo día en semana; findes con 1 día de
//    anticipación. Admin puede todo: ver todos los calendarios, agendar
//    a cualquier tatuador en cualquier agenda y cancelar sin restricción.
import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import {
  Sesion, SesionEstado, SESION_ESTADO_LABEL, Proyecto, Cliente, Tatuador,
  Puesto, PuestoTitular, formatCLP,
} from '@/lib/types'
import { useSesion } from '@/lib/sesion'
import { aplicarReglas24h } from '@/lib/sesiones'
import {
  Reserva, Bloque, BLOQUE_LABEL, bloquesDe, esFinDeSemana,
  puedeCancelar, crearReserva, cancelarReserva, hoyISO,
} from '@/lib/reservas'

type SesionFull = Sesion & {
  proyecto: (Proyecto & { cliente: Cliente | null }) | null
}

interface Calendario {
  id: string
  label: string
  tipo: 'full' | 'compartido' | 'rotativo'
  puestoIds: string[]
}

const DOT_ESTADO: Record<SesionEstado, string> = {
  espera_consentimiento: 'reservado',
  consentimiento_firmado: 'en_uso',
  completada: 'libre',
  incompleta: 'reservado',
  cancelada: 'fuera_sistema',
}

const DIAS_SEMANA = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']

function claveDia(fecha: Date): string {
  return `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}-${String(fecha.getDate()).padStart(2, '0')}`
}

export default function CalendarioPage() {
  const { sesion } = useSesion()
  const esTatuador = sesion?.rol === 'tatuador'
  const esAdminHost = sesion?.rol === 'admin' || sesion?.rol === 'host'
  const rol = sesion?.rol ?? 'admin'
  const miId = sesion?.tatuadorId ?? null

  const hoy = new Date()
  const [anio, setAnio] = useState(hoy.getFullYear())
  const [mes, setMes] = useState(hoy.getMonth())
  const [loading, setLoading] = useState(true)
  const [sesiones, setSesiones] = useState<SesionFull[]>([])
  const [reservas, setReservas] = useState<Reserva[]>([])
  const [tatuadores, setTatuadores] = useState<Tatuador[]>([])
  const [puestos, setPuestos] = useState<Puesto[]>([])
  const [titulares, setTitulares] = useState<PuestoTitular[]>([])
  const [calSel, setCalSel] = useState<string>('')
  const [diaSel, setDiaSel] = useState<string | null>(null)
  // Admin: tatuador elegido para reservar
  const [tatParaReservar, setTatParaReservar] = useState('')

  const cargar = useCallback(async () => {
    setLoading(true)
    const desde = new Date(anio, mes, 1)
    const hasta = new Date(anio, mes + 1, 1)
    const desdeISO = desde.toISOString()
    const hastaISO = hasta.toISOString()
    const desdeFecha = claveDia(desde)
    const hastaFecha = claveDia(hasta)
    const [s, r, t, p, ti] = await Promise.all([
      supabase.from('sesiones')
        .select('*, proyecto:proyectos(*, cliente:clientes(*))')
        .gte('inicio', desdeISO).lt('inicio', hastaISO)
        .order('inicio', { ascending: true }),
      supabase.from('reservas').select('*')
        .gte('fecha', desdeFecha).lt('fecha', hastaFecha)
        .eq('estado', 'activa'),
      supabase.from('tatuadores').select('*').eq('activo', true),
      supabase.from('puestos').select('*').eq('activo', true).eq('gestionado', true).order('orden'),
      supabase.from('puesto_titulares').select('*'),
    ])
    setSesiones(await aplicarReglas24h((s.data as SesionFull[]) ?? []))
    setReservas((r.data as Reserva[]) ?? [])
    setTatuadores((t.data ?? []).filter((x: Tatuador) => !x.archivado && !x.eliminado))
    setPuestos(p.data ?? [])
    setTitulares(ti.data ?? [])
    setLoading(false)
  }, [anio, mes])

  useEffect(() => { cargar() }, [cargar])

  function nombreTat(id: string): string {
    const t = tatuadores.find(x => x.id === id)
    return t ? (t.nombre_artistico || t.nombre) : '?'
  }

  // ── Calendarios disponibles ──
  const calendarios: Calendario[] = []
  for (const p of puestos.filter(x => x.tipo === 'full' || x.tipo === 'compartido')) {
    const tits = titulares.filter(t => t.puesto_id === p.id).map(t => nombreTat(t.tatuador_id))
    calendarios.push({
      id: p.id,
      label: `${p.nombre} (${p.tipo}${tits.length ? ' · ' + tits.join(' / ') : ''})`,
      tipo: p.tipo as 'full' | 'compartido',
      puestoIds: [p.id],
    })
  }
  const rotativos = puestos.filter(x => x.tipo === 'rotativo')
  if (rotativos.length > 0) {
    calendarios.push({
      id: 'rotativos',
      label: `Rotativos (${rotativos.length} cupos)`,
      tipo: 'rotativo',
      puestoIds: rotativos.map(x => x.id),
    })
  }

  // El calendario que corresponde ver según el rol
  let miCal: Calendario | null = null
  if (esTatuador && miId) {
    const yo = tatuadores.find(t => t.id === miId)
    const tipo = yo?.tipo_puesto ?? 'rotativo'
    if (tipo === 'full' || tipo === 'compartido') {
      const miTitularidad = titulares.find(t => t.tatuador_id === miId)
      miCal = calendarios.find(c => miTitularidad && c.id === miTitularidad.puesto_id) ?? null
    } else {
      miCal = calendarios.find(c => c.id === 'rotativos') ?? null
    }
  }
  const cal: Calendario | null = esTatuador
    ? miCal
    : (calendarios.find(c => c.id === calSel) ?? calendarios.find(c => c.id === 'rotativos') ?? calendarios[0] ?? null)

  // ── Datos por día del calendario activo ──
  const resDelCal = cal ? reservas.filter(r => cal.puestoIds.includes(r.puesto_id)) : []
  const resPorDia: Record<string, Reserva[]> = {}
  for (const r of resDelCal) {
    resPorDia[r.fecha] = resPorDia[r.fecha] ?? []
    resPorDia[r.fecha].push(r)
  }
  const sesVisibles = esTatuador && miId ? sesiones.filter(s => s.tatuador_id === miId) : sesiones
  const sesPorDia: Record<string, SesionFull[]> = {}
  for (const s of sesVisibles) {
    const k = claveDia(new Date(s.inicio))
    sesPorDia[k] = sesPorDia[k] ?? []
    sesPorDia[k].push(s)
  }

  function etiquetaCupo(puestoId: string): string {
    if (!cal) return ''
    if (cal.tipo !== 'rotativo') return puestos.find(p => p.id === puestoId)?.nombre ?? ''
    const idx = cal.puestoIds.indexOf(puestoId)
    return `Día ${idx + 1}`
  }

  async function reservar(fecha: string, bloque: Bloque, puestoId: string) {
    const tatuadorId = esTatuador ? miId : tatParaReservar
    if (!tatuadorId) { alert('Elige el tatuador para la reserva'); return }
    const { error } = await crearReserva({
      fecha, bloque, puesto_id: puestoId, tatuador_id: tatuadorId,
      creada_por: rol as 'tatuador' | 'host' | 'admin',
    })
    if (error) { alert(error); return }
    cargar()
  }

  async function cancelar(r: Reserva) {
    if (esTatuador) {
      if (r.tatuador_id !== miId) return
      if (!puedeCancelar(r)) {
        alert('Las reservas de fin de semana se cancelan con al menos 1 día de anticipación.')
        return
      }
    }
    if (!confirm('¿Cancelar esta reserva?')) return
    await cancelarReserva(r.id)
    cargar()
  }

  function cambiarMes(delta: number) {
    let m = mes + delta, a = anio
    if (m < 0) { m = 11; a-- }
    if (m > 11) { m = 0; a++ }
    setMes(m); setAnio(a); setDiaSel(null)
  }

  // Grilla del mes (lunes a domingo)
  const primerDia = new Date(anio, mes, 1)
  const ultimoDia = new Date(anio, mes + 1, 0)
  const offset = (primerDia.getDay() + 6) % 7
  const celdas: (Date | null)[] = []
  for (let i = 0; i < offset; i++) celdas.push(null)
  for (let d = 1; d <= ultimoDia.getDate(); d++) celdas.push(new Date(anio, mes, d))
  while (celdas.length % 7 !== 0) celdas.push(null)

  const hoyKey = hoyISO()

  if (loading) return <div className="spinner" />

  if (esTatuador && !cal) {
    return (
      <div>
        <h1 style={{ marginBottom: 12 }}>Calendario</h1>
        <div className="card vacio">
          No tienes un puesto asignado todavía. Pide al administrador que te
          asigne como titular de tu puesto (full/compartido) en la sección Puestos.
        </div>
      </div>
    )
  }

  const sesionesDia = diaSel ? (sesPorDia[diaSel] ?? []) : []
  const reservasDia = diaSel ? (resPorDia[diaSel] ?? []) : []

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 18 }}>
        <h1>Calendario</h1>
        <button className="chico secundario" onClick={() => cambiarMes(-1)}>←</button>
        <strong style={{ minWidth: 150, textAlign: 'center' }}>{MESES[mes]} {anio}</strong>
        <button className="chico secundario" onClick={() => cambiarMes(1)}>→</button>
        {esAdminHost ? (
          <select value={cal?.id ?? ''} onChange={e => { setCalSel(e.target.value); setDiaSel(null) }}
            style={{ width: 260 }}>
            {calendarios.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        ) : (
          cal && <span className="pill">{cal.label}</span>
        )}
      </div>

      {!cal ? (
        <div className="card vacio">No hay puestos gestionados configurados.</div>
      ) : (
        <>
          <div className="card" style={{ padding: 10, overflowX: 'auto' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, minWidth: 640 }}>
              {DIAS_SEMANA.map(d => (
                <div key={d} style={{ textAlign: 'center', fontSize: 11, color: 'var(--text3)',
                  textTransform: 'uppercase', letterSpacing: '0.05em', padding: '4px 0' }}>{d}</div>
              ))}
              {celdas.map((fecha, i) => {
                if (!fecha) return <div key={i} />
                const k = claveDia(fecha)
                const resDia = resPorDia[k] ?? []
                const sesDia = sesPorDia[k] ?? []
                const esHoy = k === hoyKey
                const seleccionado = k === diaSel
                const finde = esFinDeSemana(k)
                // Ocupación del día en este calendario
                const capacidad = cal.puestoIds.length * (finde ? 2 : 1)
                const ocupadas = resDia.length
                const lleno = ocupadas >= capacidad
                const tengoReserva = esTatuador && resDia.some(r => r.tatuador_id === miId)
                return (
                  <div key={i}
                    onClick={() => setDiaSel(seleccionado ? null : k)}
                    style={{
                      minHeight: 76, padding: 6, borderRadius: 8, cursor: 'pointer',
                      border: `0.5px solid ${seleccionado ? 'var(--border2)' : 'var(--border)'}`,
                      background: seleccionado ? 'var(--bg2)' : esHoy ? 'var(--info-bg)' : 'var(--bg)',
                    }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                      <span style={{ fontSize: 12, fontWeight: esHoy ? 700 : 500,
                        color: esHoy ? 'var(--info-text)' : 'var(--text2)' }}>{fecha.getDate()}</span>
                      {capacidad > 1 && (
                        <span style={{ fontSize: 9, color: lleno ? 'var(--danger-text)' : 'var(--text3)' }}>
                          {ocupadas}/{capacidad}
                        </span>
                      )}
                    </div>
                    {tengoReserva && <div style={{ fontSize: 10, color: 'var(--success-text)' }}>● Reservado</div>}
                    {!esTatuador && resDia.slice(0, 2).map(r => (
                      <div key={r.id} style={{ fontSize: 10, color: 'var(--text2)', whiteSpace: 'nowrap',
                        overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        ● {nombreTat(r.tatuador_id).split(' ')[0]}{r.bloque !== 'dia' ? ` (${r.bloque.toUpperCase()})` : ''}
                      </div>
                    ))}
                    {!esTatuador && resDia.length > 2 && (
                      <div style={{ fontSize: 9, color: 'var(--text3)' }}>+{resDia.length - 2} reservas</div>
                    )}
                    {sesDia.slice(0, 2).map(s => (
                      <div key={s.id} style={{ fontSize: 10, color: 'var(--text2)', whiteSpace: 'nowrap',
                        overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        <span className={`dot ${DOT_ESTADO[s.estado]}`} style={{ width: 7, height: 7 }} />
                        {new Date(s.inicio).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}
                        {' '}{s.proyecto?.cliente?.nombre?.split(' ')[0] ?? ''}
                      </div>
                    ))}
                    {sesDia.length > 2 && (
                      <div style={{ fontSize: 9, color: 'var(--text3)' }}>+{sesDia.length - 2} sesiones</div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* Detalle del día */}
          {diaSel && (
            <div style={{ marginTop: 14 }}>
              <h2 style={{ marginBottom: 10 }}>
                {new Date(`${diaSel}T12:00:00`).toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long' })}
                {esFinDeSemana(diaSel) && (
                  <span style={{ fontSize: 12, color: 'var(--text3)', fontWeight: 400, marginLeft: 8 }}>
                    Fin de semana: turnos AM y PM (reservar ambos = día completo, de mayor valor)
                  </span>
                )}
              </h2>

              {/* Cupos y reservas */}
              <div className="card" style={{ marginBottom: 12 }}>
                <div className="section-title">Disponibilidad de {cal.label}</div>
                {esAdminHost && (
                  <div style={{ marginBottom: 10, maxWidth: 320 }}>
                    <label>Reservar / habilitar para</label>
                    <select value={tatParaReservar} onChange={e => setTatParaReservar(e.target.value)}>
                      <option value="">— elegir tatuador —</option>
                      {tatuadores.filter(t => t.en_sistema).map(t => (
                        <option key={t.id} value={t.id}>{t.nombre_artistico || t.nombre} ({t.tipo_puesto ?? 'rotativo'})</option>
                      ))}
                    </select>
                  </div>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {cal.puestoIds.map(pid => (
                    bloquesDe(diaSel).map(bloque => {
                      const res = reservasDia.find(r => r.puesto_id === pid && r.bloque === bloque)
                      const esMia = res && esTatuador && res.tatuador_id === miId
                      const esFull = cal.tipo === 'full'
                      return (
                        <div key={`${pid}-${bloque}`}
                          style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', fontSize: 13 }}>
                          <strong style={{ minWidth: 70 }}>{etiquetaCupo(pid)}</strong>
                          {esFinDeSemana(diaSel) && <span className="pill">{BLOQUE_LABEL[bloque]}</span>}
                          {res ? (
                            <>
                              {esMia ? <span className="pill ok">Reservado por ti</span>
                                : esTatuador ? <span className="pill alerta">Ocupado</span>
                                : <span className="pill alerta">{nombreTat(res.tatuador_id)}</span>}
                              {(esMia || esAdminHost) && (
                                <button className="chico secundario" onClick={() => cancelar(res)}>
                                  Cancelar reserva
                                </button>
                              )}
                            </>
                          ) : (
                            <>
                              <span className="pill">Libre</span>
                              {/* Full: su puesto siempre está disponible para él, no reserva.
                                  Compartido y rotativo sí reservan. Admin/host reservan siempre. */}
                              {(esAdminHost || (esTatuador && !esFull)) && (
                                <button className="chico" onClick={() => reservar(diaSel, bloque, pid)}>
                                  Reservar
                                </button>
                              )}
                              {esTatuador && esFull && (
                                <span style={{ fontSize: 12, color: 'var(--text3)' }}>
                                  Tu puesto — disponible para agendar sesiones
                                </span>
                              )}
                            </>
                          )}
                        </div>
                      )
                    })
                  ))}
                </div>
              </div>

              {/* Sesiones del día */}
              {sesionesDia.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {sesionesDia.map(s => (
                    <div key={s.id} className="card" style={{ padding: 14 }}>
                      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 6 }}>
                        <strong>{new Date(s.inicio).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}</strong>
                        <span className="pill">{SESION_ESTADO_LABEL[s.estado]}</span>
                        <span>{s.proyecto?.cliente?.nombre ?? '—'}</span>
                        {!esTatuador && <span className="pill">{nombreTat(s.tatuador_id)}</span>}
                        <span className="pill">Sesión {s.numero}</span>
                        {s.proyecto && <span className="folio-badge">{s.proyecto.folio}</span>}
                        {sesion?.rol !== 'host' && (
                          <span style={{ marginLeft: 'auto', fontSize: 13 }}>
                            {formatCLP(s.valor)}{s.abonado ? ` · abonado ${formatCLP(s.abono)}` : ''}
                          </span>
                        )}
                      </div>
                      {s.proyecto?.descripcion && (
                        <p style={{ fontSize: 13, color: 'var(--text2)' }}>{s.proyecto.descripcion}</p>
                      )}
                      <p style={{ fontSize: 12, color: 'var(--text3)', marginTop: 4 }}>
                        Gestión completa en <a href="/sesiones" style={{ textDecoration: 'underline' }}>Sesiones</a>
                        {' '}o <a href="/proyectos" style={{ textDecoration: 'underline' }}>Agendar Proyecto</a>.
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
