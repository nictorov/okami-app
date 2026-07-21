'use client'
import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { Cliente, ConsentimientoResumen, formatRut, normalizarRut } from '@/lib/types'
import { useSesion } from '@/lib/sesion'
import SoloRoles from '@/components/SoloRoles'

const PAGINA = 50

type SesRow = { inicio: string; proyecto: { cliente_id: string | null } | null }

function ClientesPage() {
  const { sesion } = useSesion()
  const esTatuador = sesion?.rol === 'tatuador'
  const miId = sesion?.tatuadorId ?? null
  const [miNombre, setMiNombre] = useState<string[]>([])
  // IDs de clientes que ve el tatuador (los que ha atendido): sus proyectos
  // + los clientes de sus consentimientos (cruzados por RUT).
  //   null = aún calculando · 'all' = admin (sin restricción) · string[] = set del tatuador
  const [misIds, setMisIds] = useState<string[] | 'all' | null>(null)
  const [loading, setLoading] = useState(true)
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [total, setTotal] = useState(0)
  const [busqueda, setBusqueda] = useState('')
  const [desde, setDesde] = useState('')
  const [hasta, setHasta] = useState('')
  const [ultimaSesion, setUltimaSesion] = useState<Record<string, string>>({})
  const [conteoSesion, setConteoSesion] = useState<Record<string, number>>({})
  const [abierto, setAbierto] = useState<string | null>(null)
  const [historial, setHistorial] = useState<Record<string, ConsentimientoResumen[]>>({})

  const hayFiltroFecha = !!(desde || hasta)

  // Calcular una sola vez el conjunto de clientes del tatuador: los que ha
  // atendido según sus proyectos y sus consentimientos (por nombre → RUT).
  useEffect(() => {
    let cancel = false
    async function calcular() {
      if (!esTatuador || !miId) { setMisIds('all'); return }
      const { data: yo } = await supabase.from('tatuadores')
        .select('nombre, nombre_artistico').eq('id', miId).single()
      const nombres = [yo?.nombre, yo?.nombre_artistico].filter(Boolean) as string[]
      if (!cancel) setMiNombre(nombres)

      // a) Clientes de sus proyectos
      const { data: prj } = await supabase.from('proyectos').select('cliente_id').eq('tatuador_id', miId)
      const idsProy = (prj ?? []).map(p => p.cliente_id).filter((x): x is string => !!x)

      // b) Clientes de sus consentimientos (cruce por RUT normalizado)
      let idsRut: string[] = []
      if (nombres.length > 0) {
        const { data: cons } = await supabase.from('consentimientos').select('rut').in('tatuador', nombres)
        const ruts = Array.from(new Set((cons ?? [])
          .map(c => normalizarRut(c.rut ?? '')).filter(r => r.length >= 2)))
        if (ruts.length > 0) {
          const { data: cl } = await supabase.from('clientes').select('id').in('rut', ruts)
          idsRut = (cl ?? []).map(c => c.id)
        }
      }
      if (!cancel) setMisIds(Array.from(new Set([...idsProy, ...idsRut])))
    }
    calcular()
    return () => { cancel = true }
  }, [esTatuador, miId])

  const cargar = useCallback(async () => {
    if (misIds === null) return   // aún calculando el set del tatuador
    setLoading(true)

    // Restringe una consulta de clientes al set del tatuador (o nada si vacío)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const restringirATatuador = (r: any) =>
      (esTatuador && misIds !== 'all')
        ? r.in('id', misIds.length ? misIds : ['00000000-0000-0000-0000-000000000000'])
        : r

    // 1) Sesiones (datos de esta app) → última sesión y conteo por cliente.
    //    Respeta el rol tatuador y el rango de fechas si está activo.
    let sq = supabase.from('sesiones').select('inicio, proyecto:proyectos(cliente_id)')
    if (esTatuador && miId) sq = sq.eq('tatuador_id', miId)
    if (desde) sq = sq.gte('inicio', `${desde}T00:00:00`)
    if (hasta) sq = sq.lte('inicio', `${hasta}T23:59:59`)
    const { data: sesData } = await sq.order('inicio', { ascending: false })
    const ses = (sesData as unknown as SesRow[]) ?? []

    const ultima: Record<string, string> = {}
    const conteo: Record<string, number> = {}
    for (const s of ses) {
      const cid = s.proyecto?.cliente_id
      if (!cid) continue
      if (!ultima[cid]) ultima[cid] = s.inicio   // orden desc → primera vista = más reciente
      conteo[cid] = (conteo[cid] ?? 0) + 1
    }
    const idsConSesion = Object.keys(ultima)
    setUltimaSesion(ultima)
    setConteoSesion(conteo)

    // Filtro de búsqueda/rol reutilizable (se aplica sobre el query builder)
    const q = busqueda.trim()
    const rutNorm = normalizarRut(q)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const filtrar = (query: any): any => {
      let r = restringirATatuador(query)
      if (q) {
        if (rutNorm.length >= 5 && /^[0-9]+[0-9K]$/.test(rutNorm)) {
          r = r.ilike('rut', `${rutNorm}%`)
        } else {
          r = r.or(`nombre.ilike.%${q}%,telefono.ilike.%${q}%,email.ilike.%${q}%`)
        }
      }
      return r
    }

    // 2) Clientes con sesiones (se obtienen por id, ordenados por su última sesión)
    let conSesion: Cliente[] = []
    if (idsConSesion.length > 0) {
      const { data } = await filtrar(supabase.from('clientes').select('*'))
        .in('id', idsConSesion)
      conSesion = ((data as Cliente[]) ?? []).sort((a, b) =>
        (ultima[b.id] ?? '').localeCompare(ultima[a.id] ?? ''))
    }

    // 3) Resto de la cartera (sin sesiones), solo cuando no hay filtro de fecha
    let resto: Cliente[] = []
    let cartera = idsConSesion.length
    if (!hayFiltroFecha) {
      const { data, count } = await filtrar(
        supabase.from('clientes').select('*', { count: 'exact' }))
        .order('created_at', { ascending: false }).limit(PAGINA)
      cartera = count ?? 0
      const ya: Record<string, boolean> = {}
      conSesion.forEach(c => { ya[c.id] = true })
      resto = ((data as Cliente[]) ?? []).filter(c => !ya[c.id])
    }

    setClientes([...conSesion, ...resto])
    setTotal(hayFiltroFecha ? conSesion.length : cartera)
    setLoading(false)
  }, [busqueda, desde, hasta, hayFiltroFecha, esTatuador, miId, misIds])

  useEffect(() => {
    const timer = setTimeout(cargar, 300)
    return () => clearTimeout(timer)
  }, [cargar])

  async function abrirFicha(c: Cliente) {
    if (abierto === c.id) { setAbierto(null); return }
    setAbierto(c.id)
    if (!historial[c.id] && c.rut) {
      // Historial: consentimientos firmados con el mismo RUT (cruce por rut normalizado)
      const { data } = await supabase
        .from('consentimientos')
        .select('id, folio, nombre, rut, tatuador, estado, created_at, firmado_en')
        .order('created_at', { ascending: false })
        .limit(500)
      let propios = (data ?? []).filter(x => normalizarRut(x.rut) === c.rut)
      // Rol tatuador: solo su propio historial con este cliente
      if (esTatuador) propios = propios.filter(x => miNombre.includes(x.tatuador))
      setHistorial(h => ({ ...h, [c.id]: propios }))
    }
  }

  async function actualizar(id: string, cambios: Partial<Cliente>) {
    setClientes(cs => cs.map(c => c.id === id ? { ...c, ...cambios } : c))
    await supabase.from('clientes').update({ ...cambios, updated_at: new Date().toISOString() }).eq('id', id)
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
        <h1>Clientes</h1>
        <span style={{ color: 'var(--text2)', fontSize: '0.85rem' }}>
          {hayFiltroFecha ? `${total} con sesiones en el rango` : `${total} en cartera`}
        </span>
      </div>

      <input
        placeholder="Buscar por nombre, RUT, teléfono o email…"
        value={busqueda}
        onChange={e => setBusqueda(e.target.value)}
        style={{ marginBottom: 12 }}
      />

      {/* Filtro por rango de fechas de sesión */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 16 }}>
        <div>
          <label style={{ fontSize: '0.78rem', color: 'var(--text2)' }}>Sesiones desde</label>
          <input type="date" value={desde} max={hasta || undefined}
            onChange={e => setDesde(e.target.value)} style={{ width: 160 }} />
        </div>
        <div>
          <label style={{ fontSize: '0.78rem', color: 'var(--text2)' }}>Sesiones hasta</label>
          <input type="date" value={hasta} min={desde || undefined}
            onChange={e => setHasta(e.target.value)} style={{ width: 160 }} />
        </div>
        {hayFiltroFecha && (
          <button className="chico secundario" onClick={() => { setDesde(''); setHasta('') }}>
            Limpiar fechas
          </button>
        )}
        <span style={{ fontSize: '0.78rem', color: 'var(--text3)', marginLeft: 'auto', alignSelf: 'center' }}>
          Ordenados por sesión más reciente
        </span>
      </div>

      {loading ? <div className="spinner" /> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {clientes.map(c => {
            const expandido = abierto === c.id
            const hist = historial[c.id]
            const ult = ultimaSesion[c.id]
            const nSes = conteoSesion[c.id]
            return (
              <div key={c.id} className="card" style={{ padding: 14 }}>
                <div
                  onClick={() => abrirFicha(c)}
                  style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', cursor: 'pointer' }}
                >
                  <strong style={{ minWidth: 180 }}>{c.nombre}</strong>
                  <span style={{ color: 'var(--text3)', fontSize: '0.82rem' }}>{formatRut(c.rut)}</span>
                  {c.telefono && <span style={{ color: 'var(--text2)', fontSize: '0.82rem' }}>{c.telefono}</span>}
                  {ult && (
                    <span className="pill ok" title={`${nSes} ${nSes === 1 ? 'sesión' : 'sesiones'}`}>
                      Última sesión: {new Date(ult).toLocaleDateString('es-CL')}
                    </span>
                  )}
                  {c.marketing_ok && <span className="pill ok">Marketing OK</span>}
                  <span style={{ marginLeft: 'auto', color: 'var(--text3)' }}>{expandido ? '▲' : '▼'}</span>
                </div>

                {expandido && (
                  <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 14 }}>
                    <div className="fila-form">
                      <div>
                        <label>Teléfono</label>
                        <input value={c.telefono ?? ''}
                          onChange={e => setClientes(cs => cs.map(x => x.id === c.id ? { ...x, telefono: e.target.value } : x))}
                          onBlur={e => actualizar(c.id, { telefono: e.target.value.trim() || null })} />
                      </div>
                      <div>
                        <label>Email</label>
                        <input value={c.email ?? ''}
                          onChange={e => setClientes(cs => cs.map(x => x.id === c.id ? { ...x, email: e.target.value } : x))}
                          onBlur={e => actualizar(c.id, { email: e.target.value.trim() || null })} />
                      </div>
                      <div>
                        <label>Instagram</label>
                        <input value={c.instagram ?? ''} placeholder="@usuario"
                          onChange={e => setClientes(cs => cs.map(x => x.id === c.id ? { ...x, instagram: e.target.value } : x))}
                          onBlur={e => actualizar(c.id, { instagram: e.target.value.trim() || null })} />
                      </div>
                      <div>
                        <label>¿Cómo nos conoció?</label>
                        <select value={c.como_nos_conocio ?? ''}
                          onChange={e => actualizar(c.id, { como_nos_conocio: e.target.value || null })}>
                          <option value="">—</option>
                          <option value="instagram">Instagram</option>
                          <option value="recomendacion">Recomendación</option>
                          <option value="walk_in">Pasó por el local</option>
                          <option value="web">Web</option>
                          <option value="otro">Otro</option>
                        </select>
                      </div>
                    </div>

                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, margin: 0, cursor: 'pointer', fontSize: '0.88rem', color: 'var(--text)' }}>
                      <input type="checkbox" checked={c.marketing_ok}
                        onChange={e => actualizar(c.id, { marketing_ok: e.target.checked })}
                        style={{ width: 'auto' }} />
                      Acepta recibir comunicaciones (marketing)
                    </label>

                    <div>
                      <label>Notas</label>
                      <textarea rows={2} value={c.notas ?? ''}
                        onChange={e => setClientes(cs => cs.map(x => x.id === c.id ? { ...x, notas: e.target.value } : x))}
                        onBlur={e => actualizar(c.id, { notas: e.target.value.trim() || null })} />
                    </div>

                    <div>
                      <label style={{ marginBottom: 6 }}>Historial de consentimientos</label>
                      {!hist ? <div className="spinner" /> : hist.length === 0 ? (
                        <p style={{ color: 'var(--text3)', fontSize: '0.85rem' }}>Sin consentimientos registrados.</p>
                      ) : (
                        <table>
                          <thead>
                            <tr><th>Folio</th><th>Fecha</th><th>Tatuador</th><th>Estado</th></tr>
                          </thead>
                          <tbody>
                            {hist.map(h => (
                              <tr key={h.id}>
                                <td>{h.folio}</td>
                                <td>{h.created_at ? new Date(h.created_at).toLocaleDateString('es-CL') : '—'}</td>
                                <td>{h.tatuador}</td>
                                <td><span className={`pill ${h.estado === 'firmado' ? 'ok' : ''}`}>{h.estado}</span></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
          {clientes.length === 0 && (
            <div className="vacio">
              {hayFiltroFecha
                ? 'Ningún cliente tuvo sesiones en el rango de fechas seleccionado.'
                : busqueda ? 'Sin resultados.'
                : esTatuador ? 'Todavía no tienes clientes atendidos. Aparecerán aquí cuando registres consentimientos o proyectos con tu nombre.'
                : 'Sin clientes aún. Ejecuta la migración 002 para importar desde consentimientos.'}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function ClientesPageProtegida() {
  return <SoloRoles roles={['admin', 'tatuador']}><ClientesPage /></SoloRoles>
}
