'use client'
// Calendario mensual de sesiones. El tatuador ve las suyas; admin y host
// ven todas (con filtro por tatuador). Clic en un día → detalle de sus
// sesiones con la info del proyecto.
import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import {
  Sesion, SesionEstado, SESION_ESTADO_LABEL, Proyecto, Cliente, Tatuador,
  formatCLP,
} from '@/lib/types'
import { useSesion } from '@/lib/sesion'
import { aplicarReglas24h } from '@/lib/sesiones'

type SesionFull = Sesion & {
  proyecto: (Proyecto & { cliente: Cliente | null }) | null
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
  const miId = sesion?.tatuadorId ?? null

  const hoy = new Date()
  const [anio, setAnio] = useState(hoy.getFullYear())
  const [mes, setMes] = useState(hoy.getMonth()) // 0-11
  const [loading, setLoading] = useState(true)
  const [sesiones, setSesiones] = useState<SesionFull[]>([])
  const [tatuadores, setTatuadores] = useState<Tatuador[]>([])
  const [filtroTat, setFiltroTat] = useState('')
  const [diaSel, setDiaSel] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    setLoading(true)
    const desde = new Date(anio, mes, 1).toISOString()
    const hasta = new Date(anio, mes + 1, 1).toISOString()
    let q = supabase.from('sesiones')
      .select('*, proyecto:proyectos(*, cliente:clientes(*))')
      .gte('inicio', desde).lt('inicio', hasta)
      .order('inicio', { ascending: true })
    if (esTatuador && miId) q = q.eq('tatuador_id', miId)
    else if (filtroTat) q = q.eq('tatuador_id', filtroTat)
    const [s, t] = await Promise.all([
      q,
      supabase.from('tatuadores').select('*').eq('activo', true),
    ])
    setSesiones(await aplicarReglas24h((s.data as SesionFull[]) ?? []))
    setTatuadores((t.data ?? []).filter((x: Tatuador) => !x.archivado && !x.eliminado))
    setLoading(false)
  }, [anio, mes, esTatuador, miId, filtroTat])

  useEffect(() => { cargar() }, [cargar])

  function cambiarMes(delta: number) {
    let m = mes + delta, a = anio
    if (m < 0) { m = 11; a-- }
    if (m > 11) { m = 0; a++ }
    setMes(m); setAnio(a); setDiaSel(null)
  }

  function nombreTat(id: string): string {
    const t = tatuadores.find(x => x.id === id)
    return t ? (t.nombre_artistico || t.nombre) : '?'
  }

  // Grilla del mes: semanas de lunes a domingo
  const primerDia = new Date(anio, mes, 1)
  const ultimoDia = new Date(anio, mes + 1, 0)
  const offset = (primerDia.getDay() + 6) % 7 // lunes = 0
  const celdas: (Date | null)[] = []
  for (let i = 0; i < offset; i++) celdas.push(null)
  for (let d = 1; d <= ultimoDia.getDate(); d++) celdas.push(new Date(anio, mes, d))
  while (celdas.length % 7 !== 0) celdas.push(null)

  const porDia: Record<string, SesionFull[]> = {}
  for (const s of sesiones) {
    const k = claveDia(new Date(s.inicio))
    porDia[k] = porDia[k] ?? []
    porDia[k].push(s)
  }

  const hoyKey = claveDia(new Date())
  const sesionesDia = diaSel ? (porDia[diaSel] ?? []) : []

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 18 }}>
        <h1>Calendario</h1>
        <button className="chico secundario" onClick={() => cambiarMes(-1)}>←</button>
        <strong style={{ minWidth: 150, textAlign: 'center' }}>{MESES[mes]} {anio}</strong>
        <button className="chico secundario" onClick={() => cambiarMes(1)}>→</button>
        {!esTatuador && (
          <select value={filtroTat} onChange={e => setFiltroTat(e.target.value)} style={{ width: 190 }}>
            <option value="">Todos los tatuadores</option>
            {tatuadores.filter(t => t.en_sistema).map(t => (
              <option key={t.id} value={t.id}>{t.nombre_artistico || t.nombre}</option>
            ))}
          </select>
        )}
      </div>

      {loading ? <div className="spinner" /> : (
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
                const dia = porDia[k] ?? []
                const esHoy = k === hoyKey
                const seleccionado = k === diaSel
                return (
                  <div key={i}
                    onClick={() => setDiaSel(seleccionado ? null : k)}
                    style={{
                      minHeight: 72, padding: 6, borderRadius: 8, cursor: 'pointer',
                      border: `0.5px solid ${seleccionado ? 'var(--border2)' : 'var(--border)'}`,
                      background: seleccionado ? 'var(--bg2)' : esHoy ? 'var(--info-bg)' : 'var(--bg)',
                    }}>
                    <div style={{ fontSize: 12, fontWeight: esHoy ? 700 : 500,
                      color: esHoy ? 'var(--info-text)' : 'var(--text2)', marginBottom: 4 }}>
                      {fecha.getDate()}
                    </div>
                    {dia.slice(0, 3).map(s => (
                      <div key={s.id} style={{ fontSize: 10, color: 'var(--text2)', whiteSpace: 'nowrap',
                        overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        <span className={`dot ${DOT_ESTADO[s.estado]}`} style={{ width: 7, height: 7 }} />
                        {new Date(s.inicio).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}
                        {' '}{s.proyecto?.cliente?.nombre?.split(' ')[0] ?? ''}
                      </div>
                    ))}
                    {dia.length > 3 && (
                      <div style={{ fontSize: 10, color: 'var(--text3)' }}>+{dia.length - 3} más</div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* Detalle del día seleccionado */}
          {diaSel && (
            <div style={{ marginTop: 14 }}>
              <h2 style={{ marginBottom: 10 }}>
                {new Date(`${diaSel}T12:00:00`).toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long' })}
              </h2>
              {sesionesDia.length === 0 ? (
                <div className="vacio">Sin sesiones este día.</div>
              ) : (
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
                        Gestión completa en la sección <a href="/sesiones" style={{ textDecoration: 'underline' }}>Sesiones</a>
                        {' '}o en <a href="/proyectos" style={{ textDecoration: 'underline' }}>Agendar Proyecto</a>.
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
