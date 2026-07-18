'use client'
// Analytics — Tatuador: sus propios ingresos, tatuajes y clientes.
//             Admin: ingresos del estudio completo por tipo de tatuador,
//             arriendos según las reglas de cobro, y las mismas tablas
//             agregadas con filtro por tatuador.
//
// Modelo de ingresos por tatuajes:
//  * El abono ingresa cuando se marca "abonado" (fecha abonado_en;
//    sesiones antiguas sin fecha usan su inicio).
//  * El saldo (valor - abono) ingresa cuando la sesión termina
//    (completada o incompleta), en la fecha de la sesión.
//  * En canceladas solo queda el abono pagado.
import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { Sesion, Proyecto, Cliente, Estilo, Tatuador, formatCLP } from '@/lib/types'
import { Reserva } from '@/lib/reservas'
import { arriendoRotativo, arriendoGuest, ARRIENDO_DEFAULT } from '@/lib/arriendo'
import { useSesion } from '@/lib/sesion'
import SoloRoles from '@/components/SoloRoles'

type SesionA = Sesion & { proyecto: (Proyecto & { cliente: Cliente | null }) | null }
interface HistRow { inicio: string; estado: string; cliente_id: string | null; tatuador_id: string }

// Paleta categórica validada (CVD-safe sobre superficie clara)
const COLOR_M = '#2e6fbd'
const COLOR_F = '#c04f86'
const COLOR_O = '#3a7d44'
const COLOR_SALDO = '#211a15'
const COLOR_ABONO = '#9b9b96'
const TIPO_COLOR: Record<string, string> = {
  full: '#211a15', compartido: '#2e6fbd', rotativo: '#c04f86', guest: '#3a7d44',
}
const TIPOS_ORDEN = ['full', 'compartido', 'rotativo', 'guest'] as const
const TIPO_NOMBRE: Record<string, string> = {
  full: 'Full', compartido: 'Compartido', rotativo: 'Rotativo', guest: 'Guest',
}

const MESES_CORTO = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
const EDAD_BUCKETS = ['<18', '18–24', '25–31', '32–38', '39–45', '46+']

// Geometría común de los gráficos SVG
const W = 720, H = 200, PAD_L = 48, PAD_B = 22, PAD_T = 10
const plotW = W - PAD_L - 8, plotH = H - PAD_T - PAD_B

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

function usePeriodo() {
  const ahora = new Date()
  const [modo, setModo] = useState<'mes' | 'anio'>('mes')
  const [mes, setMes] = useState(hoyISO().slice(0, 7))
  const [anio, setAnio] = useState(ahora.getFullYear())
  const desde = modo === 'mes' ? `${mes}-01` : `${anio}-01-01`
  const hasta = modo === 'mes'
    ? (() => { const [a, m] = mes.split('-').map(Number); return `${m === 12 ? a + 1 : a}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01` })()
    : `${anio + 1}-01-01`
  const nBuckets = modo === 'mes'
    ? new Date(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)), 0).getDate()
    : 12
  const bucketDe = (iso: string) => modo === 'mes'
    ? Number(iso.slice(8, 10)) - 1
    : Number(iso.slice(5, 7)) - 1
  return { modo, setModo, mes, setMes, anio, setAnio, desde, hasta, nBuckets, bucketDe, ahora }
}

function SelectorPeriodo({ p }: { p: ReturnType<typeof usePeriodo> }) {
  return (
    <>
      <button className={`chico ${p.modo === 'mes' ? '' : 'secundario'}`} onClick={() => p.setModo('mes')}>Mes</button>
      <button className={`chico ${p.modo === 'anio' ? '' : 'secundario'}`} onClick={() => p.setModo('anio')}>Año completo</button>
      {p.modo === 'mes' ? (
        <input type="month" value={p.mes} onChange={e => e.target.value && p.setMes(e.target.value)} style={{ width: 160 }} />
      ) : (
        <select value={p.anio} onChange={e => p.setAnio(Number(e.target.value))} style={{ width: 110 }}>
          {[0, 1, 2, 3].map(d => {
            const a = p.ahora.getFullYear() - d
            return <option key={a} value={a}>{a}</option>
          })}
        </select>
      )}
    </>
  )
}

// ── Gráfico de barras apiladas abono + saldo ──
function ChartIngresos({ abonos, saldos, modo }: { abonos: number[]; saldos: number[]; modo: 'mes' | 'anio' }) {
  const n = abonos.length
  const maxBar = Math.max(1, ...abonos.map((a, i) => a + saldos[i]))
  const barW = Math.max(3, Math.floor(plotW / n) - 2)
  const yDe = (v: number) => PAD_T + plotH - (v / maxBar) * plotH
  return (
    <div style={{ overflowX: 'auto' }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', minWidth: 480, display: 'block' }} role="img"
        aria-label={`Ingresos ${modo === 'mes' ? 'por día' : 'por mes'}`}>
        {[maxBar, maxBar / 2].map(v => (
          <g key={v}>
            <line x1={PAD_L} x2={W - 8} y1={yDe(v)} y2={yDe(v)} stroke="rgba(0,0,0,0.08)" />
            <text x={PAD_L - 6} y={yDe(v) + 4} textAnchor="end" fontSize="10" fill="#9b9b96">{compactoCLP(v)}</text>
          </g>
        ))}
        <line x1={PAD_L} x2={W - 8} y1={PAD_T + plotH} y2={PAD_T + plotH} stroke="rgba(0,0,0,0.22)" />
        {abonos.map((a, i) => {
          const total = a + saldos[i]
          const x = PAD_L + (i / n) * plotW + 1
          const yA = yDe(a), yS = yDe(total)
          return (
            <g key={i}>
              {a > 0 && <rect x={x} y={yA} width={barW} height={PAD_T + plotH - yA} fill={COLOR_ABONO} rx="2" />}
              {saldos[i] > 0 && <rect x={x} y={yS} width={barW} height={Math.max(yA - yS - (a > 0 ? 2 : 0), 1)} fill={COLOR_SALDO} rx="2" />}
              <rect x={x - 1} y={PAD_T} width={barW + 2} height={plotH} fill="transparent">
                <title>{modo === 'mes' ? `Día ${i + 1}` : MESES_CORTO[i]}: {formatCLP(total)} (abono {formatCLP(a)} · saldo {formatCLP(saldos[i])})</title>
              </rect>
              {(modo === 'anio' || i % (n > 15 ? 4 : 2) === 0) && (
                <text x={x + barW / 2} y={H - 6} textAnchor="middle" fontSize="9" fill="#9b9b96">
                  {modo === 'mes' ? i + 1 : MESES_CORTO[i]}
                </text>
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

function LeyendaIngresos() {
  return (
    <div style={{ display: 'flex', gap: 14, fontSize: 12, color: 'var(--text2)' }}>
      <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: COLOR_ABONO, marginRight: 5 }} />Abonos</span>
      <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: COLOR_SALDO, marginRight: 5 }} />Saldo al cierre</span>
    </div>
  )
}

// ── Estadísticas de tatuaje (tabla) ──
function SeccionEstadisticas({ realizadas, estilos }: { realizadas: SesionA[]; estilos: Estilo[] }) {
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

  return (
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
  )
}

// ── Data clientes (gráfico + tablas) ──
function SeccionClientes({ realizadas, historico, desde }: {
  realizadas: SesionA[]; historico: HistRow[]; desde: string
}) {
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

  const primeraDe = new Map<string, string>()
  for (const h of historico) {
    if (!h.cliente_id) continue
    const prev = primeraDe.get(h.cliente_id)
    if (!prev || h.inicio < prev) primeraDe.set(h.cliente_id, h.inicio)
  }
  let nuevos = 0, retornantes = 0
  Array.from(porCliente.keys()).forEach(cid => {
    const primera = primeraDe.get(cid)
    if (primera && primera.slice(0, 10) < desde) retornantes++
    else nuevos++
  })
  const top5 = Array.from(porCliente.values())
    .sort((a, b) => b.sesiones - a.sesiones || b.total - a.total).slice(0, 5)

  const lineas = { masculino: Array(6).fill(0), femenino: Array(6).fill(0), otro: Array(6).fill(0) }
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
  const lx = (i: number) => PAD_L + (i / (EDAD_BUCKETS.length - 1)) * plotW
  const ly = (v: number) => PAD_T + plotH - (v / maxLinea) * plotH
  const puntos = (arr: number[]) => arr.map((v, i) => `${lx(i)},${ly(v)}`).join(' ')

  return (
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
  )
}

// Reparte los ingresos de una lista de sesiones en buckets del período
function calcularIngresos(sesiones: SesionA[], enRango: (iso: string) => boolean, bucketDe: (iso: string) => number, nBuckets: number) {
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
  return { abonos, saldos, realizadas }
}

// ════════════════ Analytics del tatuador ════════════════

function TatuadorAnalytics() {
  const { sesion } = useSesion()
  const miId = sesion?.tatuadorId ?? null
  const p = usePeriodo()
  const [loading, setLoading] = useState(true)
  const [sesiones, setSesiones] = useState<SesionA[]>([])
  const [historico, setHistorico] = useState<HistRow[]>([])
  const [estilos, setEstilos] = useState<Estilo[]>([])

  const cargar = useCallback(async () => {
    if (!miId) return
    setLoading(true)
    const sel = '*, proyecto:proyectos(*, cliente:clientes(*))'
    const [porInicio, porAbono, hist, est] = await Promise.all([
      supabase.from('sesiones').select(sel).eq('tatuador_id', miId)
        .gte('inicio', `${p.desde}T00:00:00`).lt('inicio', `${p.hasta}T00:00:00`),
      supabase.from('sesiones').select(sel).eq('tatuador_id', miId)
        .gte('abonado_en', `${p.desde}T00:00:00`).lt('abonado_en', `${p.hasta}T00:00:00`),
      supabase.from('sesiones')
        .select('inicio, estado, tatuador_id, proyecto:proyectos(cliente_id)')
        .eq('tatuador_id', miId).in('estado', ['completada', 'incompleta']),
      supabase.from('estilos').select('*'),
    ])
    const mapa = new Map<string, SesionA>()
    for (const s of [(porInicio.data ?? []), (porAbono.data ?? [])].flat() as SesionA[]) mapa.set(s.id, s)
    setSesiones(Array.from(mapa.values()))
    setHistorico(((hist.data ?? []) as unknown as { inicio: string; estado: string; tatuador_id: string; proyecto: { cliente_id: string | null } | null }[])
      .map(h => ({ inicio: h.inicio, estado: h.estado, tatuador_id: h.tatuador_id, cliente_id: h.proyecto?.cliente_id ?? null })))
    setEstilos(est.data ?? [])
    setLoading(false)
  }, [miId, p.desde, p.hasta])

  useEffect(() => { cargar() }, [cargar])

  if (loading) return <div className="spinner" />

  const enRango = (iso: string) => iso.slice(0, 10) >= p.desde && iso.slice(0, 10) < p.hasta
  const { abonos, saldos, realizadas } = calcularIngresos(sesiones, enRango, p.bucketDe, p.nBuckets)
  const totalAbono = abonos.reduce((a, b) => a + b, 0)
  const totalIngresos = totalAbono + saldos.reduce((a, b) => a + b, 0)
  const pctAbono = totalIngresos > 0 ? Math.round(totalAbono / totalIngresos * 100) : 0
  const promedioSesion = realizadas.length
    ? Math.round(realizadas.reduce((a, s) => a + (s.valor ?? 0), 0) / realizadas.length) : 0

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 18 }}>
        <h1>Analytics</h1>
        <SelectorPeriodo p={p} />
      </div>

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

      <div className="card" style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
          <div className="section-title" style={{ marginBottom: 0 }}>Ingresos {p.modo === 'mes' ? 'diarios' : 'mensuales'}</div>
          <LeyendaIngresos />
        </div>
        <ChartIngresos abonos={abonos} saldos={saldos} modo={p.modo} />
        {totalIngresos === 0 && (
          <p style={{ fontSize: 12, color: 'var(--text3)', marginTop: 6 }}>Sin ingresos registrados en este período.</p>
        )}
      </div>

      <SeccionEstadisticas realizadas={realizadas} estilos={estilos} />
      <SeccionClientes realizadas={realizadas} historico={historico} desde={p.desde} />
    </div>
  )
}

// ════════════════ Analytics del administrador ════════════════

function AdminAnalytics() {
  const p = usePeriodo()
  const [loading, setLoading] = useState(true)
  const [sesiones, setSesiones] = useState<SesionA[]>([])
  const [historico, setHistorico] = useState<HistRow[]>([])
  const [estilos, setEstilos] = useState<Estilo[]>([])
  const [tatuadores, setTatuadores] = useState<Tatuador[]>([])
  const [reservas, setReservas] = useState<Reserva[]>([])
  const [filtroTat, setFiltroTat] = useState('')

  const cargar = useCallback(async () => {
    setLoading(true)
    const sel = '*, proyecto:proyectos(*, cliente:clientes(*))'
    const [porInicio, porAbono, hist, est, tats, res] = await Promise.all([
      supabase.from('sesiones').select(sel)
        .gte('inicio', `${p.desde}T00:00:00`).lt('inicio', `${p.hasta}T00:00:00`),
      supabase.from('sesiones').select(sel)
        .gte('abonado_en', `${p.desde}T00:00:00`).lt('abonado_en', `${p.hasta}T00:00:00`),
      supabase.from('sesiones')
        .select('inicio, estado, tatuador_id, proyecto:proyectos(cliente_id)')
        .in('estado', ['completada', 'incompleta']),
      supabase.from('estilos').select('*'),
      supabase.from('tatuadores').select('*'),
      supabase.from('reservas').select('*').eq('estado', 'activa')
        .gte('fecha', p.desde).lt('fecha', p.hasta),
    ])
    const mapa = new Map<string, SesionA>()
    for (const s of [(porInicio.data ?? []), (porAbono.data ?? [])].flat() as SesionA[]) mapa.set(s.id, s)
    setSesiones(Array.from(mapa.values()))
    setHistorico(((hist.data ?? []) as unknown as { inicio: string; estado: string; tatuador_id: string; proyecto: { cliente_id: string | null } | null }[])
      .map(h => ({ inicio: h.inicio, estado: h.estado, tatuador_id: h.tatuador_id, cliente_id: h.proyecto?.cliente_id ?? null })))
    setEstilos(est.data ?? [])
    setTatuadores((tats.data as Tatuador[]) ?? [])
    setReservas((res.data as Reserva[]) ?? [])
    setLoading(false)
  }, [p.desde, p.hasta])

  useEffect(() => { cargar() }, [cargar])

  if (loading) return <div className="spinner" />

  const tipoDe = (tatuadorId: string): string => {
    const t = tatuadores.find(x => x.id === tatuadorId)
    return t?.tipo_puesto ?? 'rotativo'
  }
  const nombreTat = (id: string) => {
    const t = tatuadores.find(x => x.id === id)
    return t ? (t.nombre_artistico || t.nombre) : '?'
  }

  const enRango = (iso: string) => iso.slice(0, 10) >= p.desde && iso.slice(0, 10) < p.hasta

  // ── Principal 1: ingresos por tatuajes del estudio ──
  const { abonos, saldos, realizadas } = calcularIngresos(sesiones, enRango, p.bucketDe, p.nBuckets)
  const totalAbono = abonos.reduce((a, b) => a + b, 0)
  const totalIngresos = totalAbono + saldos.reduce((a, b) => a + b, 0)

  // KPIs separados por tipo de tatuador
  interface KpiTipo { abono: number; saldo: number; sesiones: number; sumaValor: number }
  const porTipo = new Map<string, KpiTipo>()
  const kpiDe = (tipo: string) => {
    const k = porTipo.get(tipo) ?? { abono: 0, saldo: 0, sesiones: 0, sumaValor: 0 }
    porTipo.set(tipo, k)
    return k
  }
  for (const s of sesiones) {
    const tipo = tipoDe(s.tatuador_id)
    if (s.abonado && s.abono > 0 && enRango(s.abonado_en ?? s.inicio)) kpiDe(tipo).abono += s.abono
    if (['completada', 'incompleta'].includes(s.estado) && enRango(s.inicio)) {
      const k = kpiDe(tipo)
      k.saldo += Math.max((s.valor ?? 0) - (s.abonado ? (s.abono ?? 0) : 0), 0)
      k.sesiones += 1
      k.sumaValor += s.valor ?? 0
    }
  }

  // ── Principal 2: arriendos ──
  // Meses del período (1 en modo mes, 12 en modo año)
  const mesesPeriodo: { desde: string; hasta: string }[] = p.modo === 'mes'
    ? [{ desde: p.desde, hasta: p.hasta }]
    : Array.from({ length: 12 }, (_, m) => ({
        desde: `${p.anio}-${String(m + 1).padStart(2, '0')}-01`,
        hasta: m === 11 ? `${p.anio + 1}-01-01` : `${p.anio}-${String(m + 2).padStart(2, '0')}-01`,
      }))

  const plantel = tatuadores.filter(t => t.activo && !t.archivado && !t.eliminado)
  const fulls = plantel.filter(t => t.tipo_puesto === 'full')
  const comps = plantel.filter(t => t.tipo_puesto === 'compartido')
  const rots = plantel.filter(t => (t.tipo_puesto ?? 'rotativo') === 'rotativo')

  // Arriendo por tipo, por mes del período
  const arriendoMensual: Record<string, number[]> = {
    full: [], compartido: [], rotativo: [], guest: [],
  }
  // Detalle por persona (total del período)
  const detalleRot = new Map<string, { nombre: string; detalle: number; total: number; minimo: boolean }>()
  const detalleGuest = new Map<string, { nombre: string; dias: number; total: number; rebaja: boolean }>()

  mesesPeriodo.forEach(({ desde, hasta }) => {
    arriendoMensual.full.push(fulls.reduce((a, t) => a + (t.arriendo_monto ?? ARRIENDO_DEFAULT.full ?? 0), 0))
    arriendoMensual.compartido.push(comps.reduce((a, t) => a + (t.arriendo_monto ?? ARRIENDO_DEFAULT.compartido ?? 0), 0))

    const resMes = reservas.filter(r => r.fecha >= desde && r.fecha < hasta)
    let rotMes = 0
    for (const t of rots) {
      const propias = resMes.filter(r => r.tatuador_id === t.id)
      const { total, detalle, aplicaMinimo } = arriendoRotativo(propias, t.arriendo_monto ?? 60000)
      rotMes += total
      const acc = detalleRot.get(t.id) ?? { nombre: nombreTat(t.id), detalle: 0, total: 0, minimo: false }
      acc.detalle += detalle
      acc.total += total
      acc.minimo = acc.minimo || aplicaMinimo
      detalleRot.set(t.id, acc)
    }
    arriendoMensual.rotativo.push(rotMes)

    let guestMes = 0
    const guestIds = new Set(resMes.filter(r => tipoDe(r.tatuador_id) === 'guest').map(r => r.tatuador_id))
    Array.from(guestIds).forEach(gid => {
      const propias = resMes.filter(r => r.tatuador_id === gid)
      const { total, dias, tarifaRebajada } = arriendoGuest(propias)
      guestMes += total
      const acc = detalleGuest.get(gid) ?? { nombre: nombreTat(gid), dias: 0, total: 0, rebaja: false }
      acc.dias += dias
      acc.total += total
      acc.rebaja = acc.rebaja || tarifaRebajada
      detalleGuest.set(gid, acc)
    })
    arriendoMensual.guest.push(guestMes)
  })

  const arriendoTotalTipo: Record<string, number> = {}
  TIPOS_ORDEN.forEach(t => { arriendoTotalTipo[t] = arriendoMensual[t].reduce((a, b) => a + b, 0) })
  const arriendoTotal = TIPOS_ORDEN.reduce((a, t) => a + arriendoTotalTipo[t], 0)

  // Geometría del gráfico de arriendos
  const maxArr = p.modo === 'mes'
    ? Math.max(1, ...TIPOS_ORDEN.map(t => arriendoTotalTipo[t]))
    : Math.max(1, ...arriendoMensual.full.map((_, m) => TIPOS_ORDEN.reduce((a, t) => a + arriendoMensual[t][m], 0)))
  const yArr = (v: number) => PAD_T + plotH - (v / maxArr) * plotH

  // ── Tablas filtrables por tatuador ──
  const realizadasFiltradas = filtroTat ? realizadas.filter(s => s.tatuador_id === filtroTat) : realizadas
  const historicoFiltrado = filtroTat ? historico.filter(h => h.tatuador_id === filtroTat) : historico

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 18 }}>
        <h1>Analytics del estudio</h1>
        <SelectorPeriodo p={p} />
      </div>

      {/* ── Principal 1: ingresos por tatuajes ── */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
          <div className="section-title" style={{ marginBottom: 0 }}>
            Ingresos por tatuajes {p.modo === 'mes' ? 'diarios' : 'mensuales'} · total {formatCLP(totalIngresos)}
          </div>
          <LeyendaIngresos />
        </div>
        <ChartIngresos abonos={abonos} saldos={saldos} modo={p.modo} />

        <div style={{ overflowX: 'auto', marginTop: 12 }}>
          <table>
            <thead>
              <tr><th>Tipo</th><th style={{ textAlign: 'right' }}>Ingresos</th><th style={{ textAlign: 'right' }}>% abono</th><th style={{ textAlign: 'right' }}>Promedio sesión</th><th style={{ textAlign: 'right' }}>Sesiones</th></tr>
            </thead>
            <tbody>
              {TIPOS_ORDEN.map(tipo => {
                const k = porTipo.get(tipo)
                const ing = (k?.abono ?? 0) + (k?.saldo ?? 0)
                return (
                  <tr key={tipo}>
                    <td><span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 3, background: TIPO_COLOR[tipo], marginRight: 6 }} />{TIPO_NOMBRE[tipo]}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatCLP(ing)}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{ing ? Math.round((k?.abono ?? 0) / ing * 100) : 0}%</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{k?.sesiones ? formatCLP(Math.round(k.sumaValor / k.sesiones)) : '—'}</td>
                    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{k?.sesiones ?? 0}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Principal 2: ingresos por arriendos ── */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
          <div className="section-title" style={{ marginBottom: 0 }}>
            Ingresos por arriendos · total {formatCLP(arriendoTotal)}
          </div>
          <div style={{ display: 'flex', gap: 12, fontSize: 12, color: 'var(--text2)', flexWrap: 'wrap' }}>
            {TIPOS_ORDEN.map(t => (
              <span key={t}><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: TIPO_COLOR[t], marginRight: 5 }} />{TIPO_NOMBRE[t]}</span>
            ))}
          </div>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', minWidth: 480, display: 'block' }} role="img"
            aria-label="Ingresos por arriendo según tipo de tatuador">
            {[maxArr, maxArr / 2].map(v => (
              <g key={v}>
                <line x1={PAD_L} x2={W - 8} y1={yArr(v)} y2={yArr(v)} stroke="rgba(0,0,0,0.08)" />
                <text x={PAD_L - 6} y={yArr(v) + 4} textAnchor="end" fontSize="10" fill="#9b9b96">{compactoCLP(v)}</text>
              </g>
            ))}
            <line x1={PAD_L} x2={W - 8} y1={PAD_T + plotH} y2={PAD_T + plotH} stroke="rgba(0,0,0,0.22)" />
            {p.modo === 'mes' ? (
              TIPOS_ORDEN.map((tipo, i) => {
                const v = arriendoTotalTipo[tipo]
                const bw = Math.floor(plotW / 4) - 24
                const x = PAD_L + (i / 4) * plotW + 12
                return (
                  <g key={tipo}>
                    <rect x={x} y={yArr(v)} width={bw} height={Math.max(PAD_T + plotH - yArr(v), v > 0 ? 2 : 0)} fill={TIPO_COLOR[tipo]} rx="2">
                      <title>{TIPO_NOMBRE[tipo]}: {formatCLP(v)}</title>
                    </rect>
                    <text x={x + bw / 2} y={H - 6} textAnchor="middle" fontSize="10" fill="#9b9b96">{TIPO_NOMBRE[tipo]}</text>
                    <text x={x + bw / 2} y={yArr(v) - 5} textAnchor="middle" fontSize="10" fill="#6b6b67">{compactoCLP(v)}</text>
                  </g>
                )
              })
            ) : (
              arriendoMensual.full.map((_, m) => {
                const bw = Math.max(3, Math.floor(plotW / 12) - 4)
                const x = PAD_L + (m / 12) * plotW + 2
                let yAcum = PAD_T + plotH
                const totalMes = TIPOS_ORDEN.reduce((a, t) => a + arriendoMensual[t][m], 0)
                return (
                  <g key={m}>
                    {TIPOS_ORDEN.map(tipo => {
                      const v = arriendoMensual[tipo][m]
                      if (v <= 0) return null
                      const h = (v / maxArr) * plotH
                      yAcum -= h
                      return <rect key={tipo} x={x} y={yAcum + 1} width={bw} height={Math.max(h - 2, 1)} fill={TIPO_COLOR[tipo]} rx="2" />
                    })}
                    <rect x={x - 1} y={PAD_T} width={bw + 2} height={plotH} fill="transparent">
                      <title>{MESES_CORTO[m]}: {formatCLP(totalMes)}{TIPOS_ORDEN.map(t => ` · ${TIPO_NOMBRE[t]} ${formatCLP(arriendoMensual[t][m])}`).join('')}</title>
                    </rect>
                    <text x={x + bw / 2} y={H - 6} textAnchor="middle" fontSize="9" fill="#9b9b96">{MESES_CORTO[m]}</text>
                  </g>
                )
              })
            )}
          </svg>
        </div>

        <details style={{ marginTop: 10 }}>
          <summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
            Monto a cobrar por rotativo ({detalleRot.size})
          </summary>
          <table style={{ marginTop: 8 }}>
            <thead><tr><th>Tatuador</th><th style={{ textAlign: 'right' }}>Por reservas</th><th style={{ textAlign: 'right' }}>A cobrar</th></tr></thead>
            <tbody>
              {Array.from(detalleRot.values()).sort((a, b) => b.total - a.total).map(d => (
                <tr key={d.nombre}>
                  <td>{d.nombre}{d.minimo && <span className="pill alerta" style={{ marginLeft: 6 }}>aplica mínimo</span>}</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatCLP(d.detalle)}</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}><strong>{formatCLP(d.total)}</strong></td>
                </tr>
              ))}
              {detalleRot.size === 0 && <tr><td style={{ color: 'var(--text3)' }}>Sin rotativos en el plantel</td></tr>}
            </tbody>
          </table>
        </details>

        <details style={{ marginTop: 8 }}>
          <summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
            Monto a cobrar por guest activo ({detalleGuest.size})
          </summary>
          <table style={{ marginTop: 8 }}>
            <thead><tr><th>Guest</th><th style={{ textAlign: 'right' }}>Días reservados</th><th style={{ textAlign: 'right' }}>A cobrar</th></tr></thead>
            <tbody>
              {Array.from(detalleGuest.values()).sort((a, b) => b.total - a.total).map(d => (
                <tr key={d.nombre}>
                  <td>{d.nombre}{d.rebaja && <span className="pill ok" style={{ marginLeft: 6 }}>tarifa rebajada</span>}</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{d.dias}</td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}><strong>{formatCLP(d.total)}</strong></td>
                </tr>
              ))}
              {detalleGuest.size === 0 && <tr><td style={{ color: 'var(--text3)' }}>Sin guests con reservas en el período</td></tr>}
            </tbody>
          </table>
        </details>
      </div>

      {/* ── Tablas agregadas, filtrables por tatuador ── */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <label style={{ margin: 0 }}>Filtrar tablas por tatuador:</label>
        <select value={filtroTat} onChange={e => setFiltroTat(e.target.value)} style={{ width: 220 }}>
          <option value="">Todos los tatuadores</option>
          {tatuadores
            .filter(t => !t.eliminado)
            .sort((a, b) => (a.nombre_artistico || a.nombre).localeCompare(b.nombre_artistico || b.nombre))
            .map(t => (
              <option key={t.id} value={t.id}>{t.nombre_artistico || t.nombre}{t.archivado ? ' (archivado)' : ''}</option>
            ))}
        </select>
      </div>

      <SeccionEstadisticas realizadas={realizadasFiltradas} estilos={estilos} />
      <SeccionClientes realizadas={realizadasFiltradas} historico={historicoFiltrado} desde={p.desde} />
    </div>
  )
}

// ════════════════ Página ════════════════

function AnalyticsRouter() {
  const { sesion } = useSesion()
  return sesion?.rol === 'admin' ? <AdminAnalytics /> : <TatuadorAnalytics />
}

export default function AnalyticsProtegida() {
  return <SoloRoles roles={['tatuador', 'admin']}><AnalyticsRouter /></SoloRoles>
}
