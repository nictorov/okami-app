'use client'
import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import {
  Cotizacion, CotizacionEstado, CotizacionOrigen, Cliente, Estilo,
  Tatuador, TatuadorEstilo, Puesto, formatCLP, formatRut, normalizarRut,
} from '@/lib/types'

const ORIGEN_LABEL: Record<CotizacionOrigen, string> = {
  estudio: 'Estudio', directa_tatuador: 'Directa a tatuador',
  instagram: 'Instagram', walk_in: 'Walk-in', web: 'Web', otro: 'Otro',
}

const ESTADO_LABEL: Record<CotizacionEstado, string> = {
  nueva: 'Nueva', asignada: 'Asignada', cotizada: 'Cotizada',
  aceptada: 'Aceptada', agendada: 'Agendada', atendida: 'Atendida', perdida: 'Perdida',
}

type Tab = 'activas' | 'agendadas' | 'cerradas'
const TAB_ESTADOS: Record<Tab, CotizacionEstado[]> = {
  activas: ['nueva', 'asignada', 'cotizada', 'aceptada'],
  agendadas: ['agendada'],
  cerradas: ['atendida', 'perdida'],
}

interface NuevaCot {
  cliente_id: string | null
  contacto_nombre: string
  contacto_medio: string
  origen: CotizacionOrigen
  descripcion: string
  zona: string
  tamano: string
  estilo_id: string
  a_color: boolean
  precio_cotizado: string
  sesiones_estimadas: string
}

const NUEVA_VACIA: NuevaCot = {
  cliente_id: null, contacto_nombre: '', contacto_medio: '',
  origen: 'estudio', descripcion: '', zona: '', tamano: '',
  estilo_id: '', a_color: false, precio_cotizado: '', sesiones_estimadas: '1',
}

export default function CotizacionesPage() {
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('activas')
  const [cotizaciones, setCotizaciones] = useState<Cotizacion[]>([])
  const [estilos, setEstilos] = useState<Estilo[]>([])
  const [tatuadores, setTatuadores] = useState<Tatuador[]>([])
  const [skills, setSkills] = useState<TatuadorEstilo[]>([])
  const [puestos, setPuestos] = useState<Puesto[]>([])
  const [cargaMes, setCargaMes] = useState<Record<string, number>>({})
  const [clientesCache, setClientesCache] = useState<Record<string, Cliente>>({})

  // Formulario nueva cotización
  const [mostrarForm, setMostrarForm] = useState(false)
  const [nueva, setNueva] = useState<NuevaCot>(NUEVA_VACIA)
  const [busquedaCliente, setBusquedaCliente] = useState('')
  const [resultadosCliente, setResultadosCliente] = useState<Cliente[]>([])
  const [guardando, setGuardando] = useState(false)

  // Agendar inline
  const [agendando, setAgendando] = useState<string | null>(null)
  const [agendaForm, setAgendaForm] = useState({ fecha: '', hora: '12:00', puesto_id: '' })

  // Perder inline
  const [perdiendo, setPerdiendo] = useState<string | null>(null)
  const [motivoPerdida, setMotivoPerdida] = useState('')

  const cargar = useCallback(async () => {
    setLoading(true)
    const hace30 = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString()
    const [c, e, t, s, p, a] = await Promise.all([
      supabase.from('cotizaciones').select('*')
        .in('estado', TAB_ESTADOS[tab])
        .order('created_at', { ascending: false }).limit(200),
      supabase.from('estilos').select('*').eq('activo', true).order('orden'),
      supabase.from('tatuadores').select('*').eq('activo', true),
      supabase.from('tatuador_estilos').select('*'),
      supabase.from('puestos').select('*').eq('activo', true).eq('gestionado', true).order('orden'),
      // Carga de trabajo últimos 30 días (para el reparto justo)
      supabase.from('atenciones').select('tatuador_id')
        .gte('inicio', hace30).in('estado', ['agendada', 'en_curso', 'completada']),
    ])
    setCotizaciones(c.data ?? [])
    setEstilos(e.data ?? [])
    setTatuadores((t.data ?? []).filter((x: Tatuador) => !x.archivado && !x.eliminado))
    setSkills(s.data ?? [])
    setPuestos(p.data ?? [])
    const carga: Record<string, number> = {}
    for (const row of a.data ?? []) carga[row.tatuador_id] = (carga[row.tatuador_id] ?? 0) + 1
    setCargaMes(carga)

    // Nombres de clientes referenciados
    const ids = Array.from(new Set((c.data ?? []).map((x: Cotizacion) => x.cliente_id).filter(Boolean))) as string[]
    if (ids.length) {
      const { data: cls } = await supabase.from('clientes').select('*').in('id', ids)
      const cache: Record<string, Cliente> = {}
      for (const cl of cls ?? []) cache[cl.id] = cl
      setClientesCache(prev => ({ ...prev, ...cache }))
    }
    setLoading(false)
  }, [tab])

  useEffect(() => { cargar() }, [cargar])

  // Búsqueda de cliente para el formulario
  useEffect(() => {
    const q = busquedaCliente.trim()
    if (q.length < 2) { setResultadosCliente([]); return }
    const timer = setTimeout(async () => {
      const rutNorm = normalizarRut(q)
      let query = supabase.from('clientes').select('*').limit(6)
      if (rutNorm.length >= 5 && /^[0-9]+[0-9K]$/.test(rutNorm)) {
        query = query.ilike('rut', `${rutNorm}%`)
      } else {
        query = query.ilike('nombre', `%${q}%`)
      }
      const { data } = await query
      setResultadosCliente(data ?? [])
    }, 300)
    return () => clearTimeout(timer)
  }, [busquedaCliente])

  async function crearCotizacion() {
    if (!nueva.cliente_id && !nueva.contacto_nombre.trim()) {
      alert('Selecciona un cliente o escribe el nombre del prospecto'); return
    }
    setGuardando(true)
    const { data: folio } = await supabase.rpc('next_folio_cotizacion')
    const { error } = await supabase.from('cotizaciones').insert({
      folio,
      cliente_id: nueva.cliente_id,
      contacto_nombre: nueva.contacto_nombre.trim() || null,
      contacto_medio: nueva.contacto_medio.trim() || null,
      origen: nueva.origen,
      descripcion: nueva.descripcion.trim() || null,
      zona: nueva.zona.trim() || null,
      tamano: nueva.tamano.trim() || null,
      estilo_id: nueva.estilo_id || null,
      a_color: nueva.a_color,
      precio_cotizado: nueva.precio_cotizado ? Number(nueva.precio_cotizado) : null,
      sesiones_estimadas: Number(nueva.sesiones_estimadas) || 1,
    })
    setGuardando(false)
    if (error) { alert('Error al guardar: ' + error.message); return }
    setNueva(NUEVA_VACIA)
    setBusquedaCliente('')
    setMostrarForm(false)
    setTab('activas')
    cargar()
  }

  async function actualizarCot(id: string, cambios: Partial<Cotizacion>) {
    setCotizaciones(cs => cs.map(c => c.id === id ? { ...c, ...cambios } : c))
    await supabase.from('cotizaciones')
      .update({ ...cambios, updated_at: new Date().toISOString() }).eq('id', id)
  }

  // Sugerencia de reparto justo: nivel en el estilo (desc), carga del mes (asc)
  function candidatos(cot: Cotizacion): { t: Tatuador; nivel: number | null; carga: number }[] {
    return tatuadores
      .filter(t => t.en_sistema && t.participa_cotizaciones)
      .map(t => {
        const skill = cot.estilo_id
          ? skills.find(s => s.tatuador_id === t.id && s.estilo_id === cot.estilo_id)
          : null
        return { t, nivel: skill?.nivel ?? null, carga: cargaMes[t.id] ?? 0 }
      })
      .sort((a, b) => (b.nivel ?? 0) - (a.nivel ?? 0) || a.carga - b.carga)
  }

  async function agendar(cot: Cotizacion) {
    if (!agendaForm.fecha || !cot.tatuador_id) return
    const inicio = `${agendaForm.fecha}T${agendaForm.hora}:00`
    const { error } = await supabase.from('atenciones').insert({
      cotizacion_id: cot.id,
      cliente_id: cot.cliente_id,
      tatuador_id: cot.tatuador_id,
      puesto_id: agendaForm.puesto_id || null,
      inicio: new Date(inicio).toISOString(),
      precio_final: cot.precio_cotizado,
    })
    if (error) { alert('Error al agendar: ' + error.message); return }
    await actualizarCot(cot.id, { estado: 'agendada' })
    setAgendando(null)
    cargar()
  }

  function nombreCliente(cot: Cotizacion): string {
    if (cot.cliente_id && clientesCache[cot.cliente_id]) return clientesCache[cot.cliente_id].nombre
    return cot.contacto_nombre ?? '—'
  }

  function nombreTatuador(id: string | null): string {
    const t = tatuadores.find(x => x.id === id)
    return t ? (t.nombre_artistico || t.nombre) : ''
  }

  function nombreEstilo(id: string | null): string {
    return estilos.find(e => e.id === id)?.nombre ?? ''
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 18 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <h1>Cotizaciones</h1>
          {(['activas', 'agendadas', 'cerradas'] as Tab[]).map(x => (
            <button key={x} className={`chico ${tab === x ? '' : 'secundario'}`} onClick={() => setTab(x)}>
              {x === 'activas' ? 'Activas' : x === 'agendadas' ? 'Agendadas' : 'Cerradas'}
            </button>
          ))}
        </div>
        <button onClick={() => setMostrarForm(!mostrarForm)}>
          {mostrarForm ? 'Cerrar' : '+ Nueva cotización'}
        </button>
      </div>

      {mostrarForm && (
        <div className="card" style={{ marginBottom: 18 }}>
          <h3 style={{ marginBottom: 12 }}>Nueva cotización</h3>

          {/* Cliente o prospecto */}
          <div style={{ marginBottom: 12 }}>
            <label>Cliente (buscar por nombre o RUT) — o deja vacío y llena el prospecto</label>
            {nueva.cliente_id ? (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span className="pill ok">
                  {clientesCache[nueva.cliente_id]?.nombre ?? 'Cliente seleccionado'}
                </span>
                <button className="chico secundario" onClick={() => setNueva({ ...nueva, cliente_id: null })}>✕ quitar</button>
              </div>
            ) : (
              <>
                <input value={busquedaCliente} placeholder="Escribe para buscar…"
                  onChange={e => setBusquedaCliente(e.target.value)} />
                {resultadosCliente.length > 0 && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                    {resultadosCliente.map(c => (
                      <button key={c.id} className="chico secundario" onClick={() => {
                        setClientesCache(prev => ({ ...prev, [c.id]: c }))
                        setNueva({ ...nueva, cliente_id: c.id, contacto_nombre: '', contacto_medio: '' })
                        setBusquedaCliente(''); setResultadosCliente([])
                      }}>
                        {c.nombre} · {formatRut(c.rut)}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          {!nueva.cliente_id && (
            <div className="fila-form" style={{ marginBottom: 12 }}>
              <div>
                <label>Nombre del prospecto</label>
                <input value={nueva.contacto_nombre}
                  onChange={e => setNueva({ ...nueva, contacto_nombre: e.target.value })} />
              </div>
              <div>
                <label>Contacto (teléfono / instagram / email)</label>
                <input value={nueva.contacto_medio}
                  onChange={e => setNueva({ ...nueva, contacto_medio: e.target.value })} />
              </div>
            </div>
          )}

          <div className="fila-form" style={{ marginBottom: 12 }}>
            <div>
              <label>Origen</label>
              <select value={nueva.origen}
                onChange={e => setNueva({ ...nueva, origen: e.target.value as CotizacionOrigen })}>
                {Object.entries(ORIGEN_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div>
              <label>Estilo</label>
              <select value={nueva.estilo_id}
                onChange={e => setNueva({ ...nueva, estilo_id: e.target.value })}>
                <option value="">—</option>
                {estilos.map(e => <option key={e.id} value={e.id}>{e.nombre}</option>)}
              </select>
            </div>
            <div>
              <label>Zona del cuerpo</label>
              <input value={nueva.zona} placeholder="ej: antebrazo"
                onChange={e => setNueva({ ...nueva, zona: e.target.value })} />
            </div>
            <div>
              <label>Tamaño</label>
              <input value={nueva.tamano} placeholder="ej: 10x15 cm"
                onChange={e => setNueva({ ...nueva, tamano: e.target.value })} />
            </div>
          </div>

          <div style={{ marginBottom: 12 }}>
            <label>Descripción de lo que quiere</label>
            <textarea rows={2} value={nueva.descripcion}
              onChange={e => setNueva({ ...nueva, descripcion: e.target.value })} />
          </div>

          <div className="fila-form" style={{ marginBottom: 14 }}>
            <div>
              <label>Precio cotizado (CLP, opcional por ahora)</label>
              <input type="number" value={nueva.precio_cotizado} placeholder="80000"
                onChange={e => setNueva({ ...nueva, precio_cotizado: e.target.value })} />
            </div>
            <div>
              <label>Sesiones estimadas</label>
              <input type="number" min={1} value={nueva.sesiones_estimadas}
                onChange={e => setNueva({ ...nueva, sesiones_estimadas: e.target.value })} />
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, margin: 0, cursor: 'pointer', color: 'var(--text)', fontSize: '0.9rem' }}>
                <input type="checkbox" checked={nueva.a_color} style={{ width: 'auto' }}
                  onChange={e => setNueva({ ...nueva, a_color: e.target.checked })} />
                A color
              </label>
            </div>
          </div>

          <button onClick={crearCotizacion} disabled={guardando}>
            {guardando ? 'Guardando…' : 'Crear cotización'}
          </button>
        </div>
      )}

      {loading ? <div className="spinner" /> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {cotizaciones.map(cot => (
            <div key={cot.id} className="card" style={{ padding: 14 }}>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
                <strong>{cot.folio}</strong>
                <span className={`pill ${cot.estado === 'atendida' ? 'ok' : cot.estado === 'perdida' ? 'peligro' : ''}`}>
                  {ESTADO_LABEL[cot.estado]}
                </span>
                <span>{nombreCliente(cot)}</span>
                {cot.estilo_id && <span className="pill">{nombreEstilo(cot.estilo_id)}{cot.a_color ? ' · color' : ''}</span>}
                {cot.zona && <span style={{ color: 'var(--text2)', fontSize: '0.85rem' }}>{cot.zona}{cot.tamano ? ` · ${cot.tamano}` : ''}</span>}
                <span style={{ marginLeft: 'auto', color: 'var(--text3)', fontSize: '0.8rem' }}>
                  {new Date(cot.created_at).toLocaleDateString('es-CL')} · {ORIGEN_LABEL[cot.origen]}
                </span>
              </div>

              {cot.descripcion && (
                <p style={{ color: 'var(--text2)', fontSize: '0.88rem', marginBottom: 8 }}>{cot.descripcion}</p>
              )}

              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                {/* Tatuador asignado / asignador justo */}
                {['nueva', 'asignada', 'cotizada'].includes(cot.estado) ? (
                  <select
                    value={cot.tatuador_id ?? ''}
                    onChange={e => actualizarCot(cot.id, {
                      tatuador_id: e.target.value || null,
                      estado: e.target.value ? (cot.estado === 'nueva' ? 'asignada' : cot.estado) : 'nueva',
                    })}
                    style={{ width: 280 }}
                  >
                    <option value="">— asignar tatuador (sugerencia justa) —</option>
                    {candidatos(cot).map(({ t, nivel, carga }) => (
                      <option key={t.id} value={t.id}>
                        {(t.nombre_artistico || t.nombre)}
                        {nivel !== null ? ` · nivel ${nivel}` : cot.estilo_id ? ' · sin ese estilo' : ''}
                        {` · ${carga} trabajos/30d`}
                      </option>
                    ))}
                  </select>
                ) : cot.tatuador_id && (
                  <span className="pill">{nombreTatuador(cot.tatuador_id)}</span>
                )}

                {/* Precio */}
                {['nueva', 'asignada', 'cotizada'].includes(cot.estado) ? (
                  <input
                    type="number" placeholder="Precio CLP"
                    defaultValue={cot.precio_cotizado ?? ''}
                    onBlur={e => {
                      const v = e.target.value ? Number(e.target.value) : null
                      if (v !== cot.precio_cotizado) {
                        actualizarCot(cot.id, {
                          precio_cotizado: v,
                          estado: v && cot.tatuador_id ? 'cotizada' : cot.estado,
                        })
                      }
                    }}
                    style={{ width: 130 }}
                  />
                ) : (
                  <strong>{formatCLP(cot.precio_cotizado)}</strong>
                )}

                {/* Transiciones */}
                {cot.estado === 'cotizada' && (
                  <button className="chico" onClick={() => actualizarCot(cot.id, { estado: 'aceptada' })}>
                    ✓ Cliente aceptó
                  </button>
                )}

                {cot.estado === 'aceptada' && (
                  agendando === cot.id ? (
                    <span style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                      <input type="date" value={agendaForm.fecha}
                        onChange={e => setAgendaForm({ ...agendaForm, fecha: e.target.value })}
                        style={{ width: 145 }} />
                      <input type="time" value={agendaForm.hora}
                        onChange={e => setAgendaForm({ ...agendaForm, hora: e.target.value })}
                        style={{ width: 100 }} />
                      <select value={agendaForm.puesto_id}
                        onChange={e => setAgendaForm({ ...agendaForm, puesto_id: e.target.value })}
                        style={{ width: 140 }}>
                        <option value="">Puesto —</option>
                        {puestos.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                      </select>
                      <button className="chico" onClick={() => agendar(cot)} disabled={!agendaForm.fecha}>Agendar</button>
                      <button className="chico secundario" onClick={() => setAgendando(null)}>✕</button>
                    </span>
                  ) : (
                    <button className="chico" onClick={() => {
                      if (!cot.tatuador_id) { alert('Asigna un tatuador antes de agendar'); return }
                      setAgendando(cot.id); setAgendaForm({ fecha: '', hora: '12:00', puesto_id: '' })
                    }}>
                      📅 Agendar atención
                    </button>
                  )
                )}

                {/* Perder */}
                {['nueva', 'asignada', 'cotizada', 'aceptada'].includes(cot.estado) && (
                  perdiendo === cot.id ? (
                    <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <input value={motivoPerdida} placeholder="Motivo de la pérdida"
                        onChange={e => setMotivoPerdida(e.target.value)} style={{ width: 200 }} />
                      <button className="chico" style={{ background: 'var(--rojo)' }}
                        onClick={() => {
                          actualizarCot(cot.id, { estado: 'perdida', motivo_perdida: motivoPerdida.trim() || null })
                          setPerdiendo(null); setMotivoPerdida('')
                        }}>Confirmar</button>
                      <button className="chico secundario" onClick={() => setPerdiendo(null)}>✕</button>
                    </span>
                  ) : (
                    <button className="chico secundario" style={{ marginLeft: 'auto' }}
                      onClick={() => setPerdiendo(cot.id)}>Marcar perdida</button>
                  )
                )}

                {cot.estado === 'perdida' && cot.motivo_perdida && (
                  <span style={{ color: 'var(--text3)', fontSize: '0.82rem' }}>Motivo: {cot.motivo_perdida}</span>
                )}
              </div>
            </div>
          ))}
          {cotizaciones.length === 0 && (
            <div className="vacio">Sin cotizaciones {tab === 'activas' ? 'activas' : tab === 'agendadas' ? 'agendadas' : 'cerradas'}.</div>
          )}
        </div>
      )}
    </div>
  )
}
