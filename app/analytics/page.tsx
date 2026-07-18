'use client'
// Analytics del tatuador: ingresos, estadísticas de tatuajes y data de
// clientes para el período elegido (mes por defecto, o año completo).
//
// Modelo de ingresos:
//  * El abono ingresa cuando se marca "abonado" (fecha abonado_en;
//    sesiones antiguas sin fecha usan su inicio).
//  * El saldo (valor - abono) ingresa cuando la sesión termina
//    (completada o incompleta), en la fecha de la sesión.
//  * Si la sesión se cancela, el saldo no se cobra pero el abono
//    pagado queda para el tatuador.
import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { Sesion, Proyecto, Cliente, Estilo, formatCLP } from '@/lib/types'
import { useSesion } from '@/lib/sesion'
import SoloRoles from '@/components/SoloRoles'

type SesionA = Sesion & { proyecto: (Proyecto & { cliente: Cliente | null }) | null }

// Paleta categórica validada (CVD-safe sobre superficie clara)
const COLOR_M = '#2e6fbd'   // masculino
const COLOR_F = '#c04f86'   // femenino
const COLOR_O = '#3a7d44'   // otro / no indicado
// Serie de ingresos: un solo tono, separado por luminosidad
const COLOR_SALDO = '#211a15'
const COLOR_ABONO = '#9b9b96'

const MESES_CORTO = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
const EDAD_BUCKETS = ['<18', '18–24', '25–31', '32–38', '39–45', '46+']

function hoyISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function edadDe(nacimiento: string | null): number | null {
  if (!nacimiento || !/^\d{4}-\d{2}-\d{2}$/.test(nacimiento)) return null
  const hoy = new Date(), nac = new Date(nacimiento)
  let e = hoy.getFullYear() - nac.getFullYear()
  const m = hoy.getMonth() - nac.getMonth()
  if (m < 0 || (m === 0 && hoy.getDate() < nac.getDate())) e--
  return e
}

function bucketEdad(edad: number): number {
  if (edad < 18) return 0
  if (edad <= 24) return 1
  if (edad <= 31) return 2
  if (edad <= 38) return 3
  if (edad <= 45) return 4
  return 5
}

function compactoCLP(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `$${Math.round(n / 1_000)}k`
  return `$${n}`
}

function conteo(mapa: Map<string, number>, top = 8): [string, number][] {
  return Array.from(mapa.entries()).sort((a, b) => b[1] - a[1]).slice(0, top)
}

function AnalyticsPage() {
  const { sesion } = useSesion()
  const miId = sesion?.tatuadorId ?? null

  const ahora = new Date()
  const [modo, setModo] = useState<'mes' | 'anio'>('mes')
  const [mes, setMes] = useState(hoyISO().slice(0, 7))
  const [anio, setAnio] = useState(ahora.getFullYear())
  const [loading, setLoading] = useState(true)
  const [sesiones, setSesiones] = useState<SesionA[]>([])
  const [historico, setHistorico] = useState<{ inicio: string; estado: string; cliente_id: string | null }[]>([])
  const [estilos, setEstilos] = useState<Estilo[]>([])

  // Rango del período
  const desde = modo === 'mes' ? `${mes}-01` : `${anio}-01-01`
  const hasta = modo === 'mes'
    ? (() => { const [a, m] = mes.split('-').map(Number); return new Date(a, m, 1).toISOString().slice(0, 10) })()
    : `${anio + 1}-01-01`

  const cargar = useCallback(async () => {
    if (!miId) return
    setLoading(true)
    const sel = '*, proyecto:proyectos(*, cliente:clientes(*))'
    const [porInicio, porAbono, hist, est] = await Promise.all([
      supabase.from('sesiones').select(sel).eq('tatuador_id', miId)
        .gte('inicio', `${desde}T00:00:00`).lt('inicio', `${hasta}T00:00:00`),
      supabase.from('sesiones').select(sel).eq('tatuador_id', miId)
        .gte('abonado_en', `${desde}T00:00:00`).lt('abonado_en', `${hasta}T00:00:00`),
      supabase.from('sesiones')
        .select('inicio, estado, proyecto:proyectos(cliente_id)')
        .eq('tatuador_id', miId).in('estado', ['completada', 'incompleta']),
      supabase.from('estilos').select('*'),
    ])
    const mapa = new Map<string, SesionA>()
    for (const s of [(porInicio.data ?? []), (porAbono.data ?? [])].flat() as SesionA[]) mapa.set(s.id, s)
    setSesiones(Array.from(mapa.values()))
    setHistorico(((hist.data ?? []) as unknown as { inicio: string; estado: string; proyecto: { cliente_id: string | null } | null }[])
      .map(h => ({ inicio: h.inicio, estado: h.estado, cliente_id: h.proyecto?.cliente_id ?? null })))
    setEstilos(est.data ?? [])
    setLoading(false)
  }, [miId, desde, hasta])

  useEffect(() => { cargar() }, [cargar])

  if (loading) return <div className="spinner" />

  const enRango = (iso: string) => iso.slice(0, 10) >= desde && iso.slice(0, 10) < hasta

  // ── Ingresos por bucket (día del mes o mes del año) ──
  const nBuckets = modo === 'mes'
    ? new Date(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)), 0).getDate()
    : 12
  const bucketDe = (iso: string) => modo === 'mes'
    ? Number(iso.slice(8, 10)) - 1
    : Number(iso.slice(5, 7)) - 1
  const abonos = Array(nBuckets).fill(0)
  const saldos = Array(nBuckets).fill(0)

  const realizadas: SesionA[] = []
  for (const s of sesiones) {
    if (s.abonado && s.abono > 0) {
      const f = s.abonado_en ?? s.inicio
      if (enRango(f)) abonos[bucketDe(f)] += s.abono
    }
    if (['completada', 'incompleta'].includes(s.estado) && enRango(s.inicio)) {
      realizadas.push(s)
      saldos[bucketDe(s.inicio)] += Math.max((s.valor ?? 0) - (s.abonado ? (s.abono ?? 0) : 0), 0)
    }
  }
  const totalAbono = abonos.reduce((a, b) => a + b, 0)
  const totalSaldo = saldos.reduce((a, b) => a + b, 0)
  const totalIngresos = totalAbono + totalSaldo
  const pctAbono = totalIngresos > 0 ? Math.round(totalAbono / totalIngresos * 100) : 0
  const promedioSesion = realizadas.length
    ? Math.round(realizadas.reduce((a, s) => a + (s.valor ?? 0), 0) / realizadas.length) : 0

  // ── Estadísticas de tatuaje (proyectos con sesiones realizadas) ──
  const proyectosMap = new Map<string, Proyecto & { cliente: Cliente | null }>()
  for (const s of realizadas) if (s.proyecto) proyectosMap.set(s.proyecto.id, s.proyecto)
  const proyectosR = Array.from(proyectosMap.values())

  const porEstilo = new Map<string, number>()
  const porZona = new Map<string, number>()
  const porTamano = new Map<string, number>()
  let bn = 0, color = 0
  for (const p of proyectosR) {
    const est = estilos.find(e => e.id === p.estilo_id)?.nombre ?? 'Sin estilo'
    porEstilo.set(est, (porEstilo.get(est) ?? 0) + 1)
    const zona = (p.zona ?? '').trim().toLowerCase()
    if (zona) porZona.set(zona, (porZona.get(zona) ?? 0) + 1)
    const tam = (p.tamano ?? '').trim().toLowerCase()
    if (tam) porTamano.set(tam, (porTamano.get(tam) ?? 0) + 1)
    if (p.a_color === true) color++
    else if (p.a_color === false) bn++
  }
  const totalBnColor = bn + color
  const pctBn = totalBnColor ? Math.round(bn / totalBnColor * 100) : 0

  // ── Data clientes ──
  interface AccCliente { cliente: Cliente; sesiones: number; total: number }
  const porCliente = new Map<string, AccCliente>()
  for (const s of realizadas) {
    const c = s.proyecto?.cliente
    if (!c) continue
    const acc = porCliente.get(c.id) ?? { cliente: c, sesiones: 0, total: 0 }
    acc.sesiones += 1
    acc.total += s.valor ?? 0
    porCliente.set(c.id, acc)
  }

  // Nuevos vs retornantes: primera sesión realizada de la historia
  const primeraDe = new Map<string, string>()
  for (const h of historico) {
    if (!h.cliente_id) continue
    const prev = primeraDe.get(h.cliente_id)
    if (!prev || h.inicio < prev) primeraDe.set(h.cliente_id, h.inicio)
  }
  let nuevos = 0, retornantes = 0
  for (const cid of Array.from(porCliente.keys())) {
    const primera = primeraDe.get(cid)
    if (primera && primera.slice(0, 10) < desde) retornantes++
    else nuevos++
  }
  const top5 = Array.from(porCliente.values())
    .sort((a, b) => b.sesiones - a.sesiones || b.total - a.total).slice(0, 5)

  // Edad × género (cantidad de tatuajes = sesiones realizadas)
  const lineas = {
    masculino: Array(6).fill(0),
    femenino: Array(6).fill(0),
    otro: Array(6).fill(0),
  }
  for (const s of realizadas) {
    const c = s.proyecto?.cliente
    if (!c) continue
    const edad = edadDe(c.nacimiento)
    if (edad === null) continue
    const b = bucketEdad(edad)
    const g = c.genero === 'masculino' ? 'masculino' : c.genero === 'femenino' ? 'femenino' : 'otro'
    lineas[g][b] += 1
  }
  const maxLinea = Math.max(1, ...lineas.masculino, ...lineas.femenino, ...lineas.otro)

  // ── Geometría de los gráficos (SVG) ──
  const W = 720, H = 200, PAD_L = 44, PAD_B = 22, PAD_T = 10
  const plotW = W - PAD_L - 8, plotH = H - PAD_T - PAD_B
  const maxBar = Math.max(1, ...abonos.map((a, i) => a + saldos[i]))
  const barW = Math.max(3, Math.floor(plotW / nBuckets) - 2)
  const yDe = (v: number) => PAD_T + plotH - (v / maxBar) * plotH
  const gridVals = [maxBar, maxBar / 2]

  const lx = (i: number) => PAD_L + (i / (EDAD_BUCKETS.length - 1)) * plotW
  const ly = (v: number) => PAD_T + plotH - (v / maxLinea) * plotH
  const puntos = (arr: number[]) => arr.map((v, i) => `${lx(i)},${ly(v)}`).join(' ')

  const tituloBucket = (i: number) => modo === 'mes' ? `${i + 1}` : MESES_CORTO[i]

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 18 }}>
        <h1>Analytics</h1>
        <button className={`chico ${modo === 'mes' ? '' : 'secundario'}`} onClick={() => setModo('mes')}>Mes</button>
        <button className={`chico ${modo === 'anio' ? '' : 'secundario'}`} onClick={() => setModo('anio')}>Año completo</button>
        {modo === 'mes' ? (
          <input type="month" value={mes} onChange={e => e.target.value && setMes(e.target.value)} style={{ width: 160 }} />
        ) : (
          <select value={anio} onChange={e => setAnio(Number(e.target.value))} style={{ width: 110 }}>
            {[0, 1, 2, 3].map(d => {
              const a = ahora.getFullYear() - d
              return <option key={a} value={a}>{a}</option>
            })}
          </select>
        )}
      </div>

      {/* ── KPIs ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 14 }}>
        {[
          { label: 'Ingresos del período', valor: formatCLP(totalIngresos) },
          { label: '% ingresos de abono', valor: `${pctAbono}%` },
          { label: 'Promedio por sesión', valor: formatCLP(promedioSesion) },
          { label: 'Sesiones realizadas', valor: String(realizadas.length) },
        ].map(k => (
          <div key={k.label} className="card" style={{ padding: '12px 16px' }}>
            <div style={{ fontSize: 11, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{k.label}</div>
            <div style={{ fontSize: '1.4rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{k.valor}</div>
          </div>
        ))}
      </div>

      {/* ── Gráfico de ingresos ── */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
          <div className="section-title" style={{ marginBottom: 0 }}>
            Ingresos {modo === 'mes' ? 'diarios' : 'mensuales'}
          </div>
          <div style={{ display: 'flex', gap: 14, fontSize: 12, color: 'var(--text2)' }}>
            <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: COLOR_ABONO, marginRight: 5 }} />Abonos</span>
            <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: COLOR_SALDO, marginRight: 5 }} />Saldo al cierre</span>
          </div>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', minWidth: 480, display: 'block' }} role="img"
            aria-label={`Ingresos ${modo === 'mes' ? 'por día' : 'por mes'} del período`}>
            {gridVals.map(v => (
              <g key={v}>
                <line x1={PAD_L} x2={W - 8} y1={yDe(v)} y2={yDe(v)} stroke="rgba(0,0,0,0.08)" />
                <text x={PAD_L - 6} y={yDe(v) + 4} textAnchor="end" fontSize="10" fill="#9b9b96">{compactoCLP(v)}</text>
              </g>
            ))}
            <line x1={PAD_L} x2={W - 8} y1={PAD_T + plotH} y2={PAD_T + plotH} stroke="rgba(0,0,0,0.22)" />
            {abonos.map((a, i) => {
              const total = a + saldos[i]
              if (nBuckets > 15 && i % 2 === 1 && modo === 'mes') { /* etiquetas alternadas */ }
              const x = PAD_L + (i / nBuckets) * plotW + 1
              const yA = yDe(a)
              const yS = yDe(total)
              return (
                <g key={i}>
                  {a > 0 && <rect x={x} y={yA} width={barW} height={PAD_T + plotH - yA} fill={COLOR_ABONO} rx="2" />}
                  {saldos[i] > 0 && <rect x={x} y={yS} width={barW} height={Math.max(yA - yS - (a > 0 ? 2 : 0), 1)} fill={COLOR_SALDO} rx="2" />}
                  <rect x={x - 1} y={PAD_T} width={barW + 2} height={plotH} fill="transparent">
                    <title>{modo === 'mes' ? `Día ${i + 1}` : MESES_CORTO[i]}: {formatCLP(total)} (abono {formatCLP(a)} · saldo {formatCLP(saldos[i])})</title>
                  </rect>
                  {(modo === 'anio' || i % (nBuckets > 15 ? 4 : 2) === 0) && (
                    <text x={x + barW / 2} y={H - 6} textAnchor="middle" fontSize="9" fill="#9b9b96">{tituloBucket(i)}</text>
                  )}
                </g>
              )
            })}
          </svg>
        </div>
        {totalIngresos === 0 && (
          <p style={{ fontSize: 12, color: 'var(--text3)', marginTop: 6 }}>Sin ingresos registrados en este período.</p>
        )}
      </div>

      {/* ── Estadísticas de tatuaje ── */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="section-title">Estadísticas de tatuaje ({proyectosR.length} tatuaje{proyectosR.length !== 1 ? 's' : ''} con sesiones realizadas)</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 14 }}>
          <div>
            <label>Por estilo</label>
            <table><tbody>
              {conteo(porEstilo).map(([k, v]) => <tr key={k}><td>{k}</td><td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{v}</td></tr>)}
              {porEstilo.size === 0 && <tr><td style={{ color: 'var(--text3)' }}>Sin datos</td></tr>}
            </tbody></table>
          </div>
          <div>
            <label>Por parte del cuerpo</label>
            <table><tbody>
              {conteo(porZona).map(([k, v]) => <tr key={k}><td style={{ textTransform: 'capitalize' }}>{k}</td><td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{v}</td></tr>)}
              {porZona.size === 0 && <tr><td style={{ color: 'var(--text3)' }}>Sin datos</td></tr>}
            </tbody></table>
          </div>
          <div>
            <label>Blanco y negro vs color</label>
            <table><tbody>
              <tr><td>Blanco y negro</td><td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{totalBnColor ? `${pctBn}%` : '—'}</td></tr>
              <tr><td>Color</td><td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{totalBnColor ? `${100 - pctBn}%` : '—'}</td></tr>
            </tbody></table>
            <label style={{ marginTop: 12 }}>Tamaños más frecuentes</label>
            <table><tbody>
              {conteo(porTamano, 5).map(([k, v]) => <tr key={k}><td>{k}</td><td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{v}</td></tr>)}
              {porTamano.size === 0 && <tr><td style={{ color: 'var(--text3)' }}>Sin datos</td></tr>}
            </tbody></table>
          </div>
        </div>
      </div>

      {/* ── Data clientes ── */}
      <div className="card">
        <div className="section-title">Data clientes</div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 6 }}>
          <label style={{ margin: 0 }}>Tatuajes por edad y género</label>
          <div style={{ display: 'flex', gap: 14, fontSize: 12, color: 'var(--text2)' }}>
            <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 99, background: COLOR_M, marginRight: 5 }} />Hombres</span>
            <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 99, background: COLOR_F, marginRight: 5 }} />Mujeres</span>
            <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 99, background: COLOR_O, marginRight: 5 }} />Otro / N.I.</span>
          </div>
        </div>
        <div style={{ overflowX: 'auto', marginBottom: 14 }}>
          <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', minWidth: 480, display: 'block' }} role="img"
            aria-label="Cantidad de tatuajes por rango de edad y género">
            {[maxLinea, maxLinea / 2].map(v => (
              <g key={v}>
                <line x1={PAD_L} x2={W - 8} y1={ly(v)} y2={ly(v)} stroke="rgba(0,0,0,0.08)" />
                <text x={PAD_L - 6} y={ly(v) + 4} textAnchor="end" fontSize="10" fill="#9b9b96">{Math.round(v)}</text>
              </g>
            ))}
            <line x1={PAD_L} x2={W - 8} y1={PAD_T + plotH} y2={PAD_T + plotH} stroke="rgba(0,0,0,0.22)" />
            {EDAD_BUCKETS.map((b, i) => (
              <text key={b} x={lx(i)} y={H - 6} textAnchor="middle" fontSize="10" fill="#9b9b96">{b}</text>
            ))}
            {([['masculino', COLOR_M], ['femenino', COLOR_F], ['otro', COLOR_O]] as const).map(([g, c]) => (
              <g key={g}>
                <polyline points={puntos(lineas[g])} fill="none" stroke={c} strokeWidth="2" />
                {lineas[g].map((v, i) => (
                  <circle key={i} cx={lx(i)} cy={ly(v)} r="4" fill={c} stroke="#ffffff" strokeWidth="2">
                    <title>{g === 'otro' ? 'Otro/N.I.' : g}: {v} tatuaje{v !== 1 ? 's' : ''} ({EDAD_BUCKETS[i]} años)</title>
                  </circle>
                ))}
              </g>
            ))}
          </svg>
        </div>
        <p style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 16 }}>
          El género y la edad vienen del consentimiento informado; los clientes sin ese dato cuentan en &quot;Otro / N.I.&quot; o quedan fuera del gráfico de edad.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 14 }}>
          <div>
            <label>Clientes del período</label>
            <table><tbody>
              <tr><td>Clientes nuevos tatuados</td><td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{nuevos}</td></tr>
              <tr><td>Clientes retornantes</td><td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{retornantes}</td></tr>
            </tbody></table>
          </div>
          <div>
            <label>Top 5 clientes frecuentes</label>
            <table><tbody>
              {top5.map(t => (
                <tr key={t.cliente.id}>
                  <td>{t.cliente.nombre}</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{t.sesiones} ses. · {formatCLP(t.total)}</td>
                </tr>
              ))}
              {top5.length === 0 && <tr><td style={{ color: 'var(--text3)' }}>Sin datos</td></tr>}
            </tbody></table>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function AnalyticsProtegida() {
  return <SoloRoles roles={['tatuador']}><AnalyticsPage /></SoloRoles>
}
