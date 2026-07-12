'use client'
import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import {
  Atencion, AtencionEstado, Cliente, Tatuador, Puesto,
  ConsentimientoResumen, formatCLP, formatRut, normalizarRut,
} from '@/lib/types'

type AtencionFull = Atencion & { cliente: { id: string; nombre: string; rut: string | null } | null }

const ESTADO_LABEL: Record<AtencionEstado, string> = {
  agendada: 'Agendada', en_curso: 'En curso', completada: 'Completada',
  cancelada: 'Cancelada', no_show: 'No llegó',
}

type Tab = 'hoy' | 'proximas' | 'historial'

function hoyISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function mesActual(): string {
  return hoyISO().slice(0, 7)
}

export default function AtencionesPage() {
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('hoy')
  const [mes, setMes] = useState(mesActual())
  const [atenciones, setAtenciones] = useState<AtencionFull[]>([])
  const [tatuadores, setTatuadores] = useState<Tatuador[]>([])
  const [puestos, setPuestos] = useState<Puesto[]>([])

  // Nueva atención directa (walk-in)
  const [mostrarForm, setMostrarForm] = useState(false)
  const [nuevo, setNuevo] = useState({ cliente_id: '', tatuador_id: '', puesto_id: '', fecha: hoyISO(), hora: '12:00' })
  const [busquedaCliente, setBusquedaCliente] = useState('')
  const [resultadosCliente, setResultadosCliente] = useState<Cliente[]>([])
  const [clienteSel, setClienteSel] = useState<Cliente | null>(null)

  // Vincular consentimiento
  const [vinculando, setVinculando] = useState<string | null>(null)
  const [candidatosCons, setCandidatosCons] = useState<ConsentimientoResumen[]>([])
  const [buscaFolio, setBuscaFolio] = useState('')

  // Completar
  const [completando, setCompletando] = useState<string | null>(null)
  const [cierreForm, setCierreForm] = useState({ precio: '', metodo: 'efectivo', comision_pct: '30' })

  // Cancelar
  const [cancelando, setCancelando] = useState<string | null>(null)
  const [cancelaForm, setCancelaForm] = useState({ por: 'cliente', motivo: '' })

  const cargar = useCallback(async () => {
    setLoading(true)
    let query = supabase.from('atenciones')
      .select('*, cliente:clientes(id, nombre, rut)')
    const hoy = hoyISO()
    if (tab === 'hoy') {
      query = query.gte('inicio', `${hoy}T00:00:00`).lte('inicio', `${hoy}T23:59:59`)
        .order('inicio', { ascending: true })
    } else if (tab === 'proximas') {
      query = query.gt('inicio', `${hoy}T23:59:59`).in('estado', ['agendada'])
        .order('inicio', { ascending: true }).limit(100)
    } else {
      const [anio, mesNum] = mes.split('-').map(Number)
      const hasta = new Date(anio, mesNum, 1).toISOString()
      query = query.gte('inicio', `${mes}-01T00:00:00`).lt('inicio', hasta)
        .order('inicio', { ascending: false })
    }
    const [a, t, p] = await Promise.all([
      query,
      supabase.from('tatuadores').select('*').eq('activo', true),
      supabase.from('puestos').select('*').eq('activo', true).eq('gestionado', true).order('orden'),
    ])
    setAtenciones((a.data as AtencionFull[]) ?? [])
    setTatuadores((t.data ?? []).filter((x: Tatuador) => !x.archivado && !x.eliminado))
    setPuestos(p.data ?? [])
    setLoading(false)
  }, [tab, mes])

  useEffect(() => { cargar() }, [cargar])

  // Búsqueda de cliente para atención directa
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

  async function crearAtencion() {
    if (!nuevo.tatuador_id || !nuevo.fecha) { alert('Falta tatuador o fecha'); return }
    const { error } = await supabase.from('atenciones').insert({
      cliente_id: clienteSel?.id ?? null,
      tatuador_id: nuevo.tatuador_id,
      puesto_id: nuevo.puesto_id || null,
      inicio: new Date(`${nuevo.fecha}T${nuevo.hora}:00`).toISOString(),
    })
    if (error) { alert('Error: ' + error.message); return }
    setMostrarForm(false)
    setClienteSel(null); setBusquedaCliente('')
    setNuevo({ cliente_id: '', tatuador_id: '', puesto_id: '', fecha: hoyISO(), hora: '12:00' })
    cargar()
  }

  async function actualizarAt(id: string, cambios: Partial<Atencion>) {
    setAtenciones(as => as.map(a => a.id === id ? { ...a, ...cambios } : a))
    await supabase.from('atenciones')
      .update({ ...cambios, updated_at: new Date().toISOString() }).eq('id', id)
  }

  // --- Vincular consentimiento (se firma justo antes de tatuar) ---
  async function abrirVinculo(a: AtencionFull) {
    setVinculando(a.id)
    setBuscaFolio('')
    // Sugerir: consentimientos firmados en las últimas 48h, priorizando mismo RUT
    const hace48 = new Date(Date.now() - 48 * 3600 * 1000).toISOString()
    const { data } = await supabase.from('consentimientos')
      .select('id, folio, nombre, rut, tatuador, estado, created_at, firmado_en')
      .gte('created_at', hace48)
      .order('created_at', { ascending: false })
      .limit(30)
    let lista = (data ?? []) as ConsentimientoResumen[]
    if (a.cliente?.rut) {
      const rutCliente = a.cliente.rut
      lista = [...lista].sort((x, y) =>
        Number(normalizarRut(y.rut) === rutCliente) - Number(normalizarRut(x.rut) === rutCliente))
    }
    setCandidatosCons(lista)
  }

  async function buscarPorFolio() {
    const q = buscaFolio.trim()
    if (!q) return
    const { data } = await supabase.from('consentimientos')
      .select('id, folio, nombre, rut, tatuador, estado, created_at, firmado_en')
      .ilike('folio', `%${q}%`)
      .order('created_at', { ascending: false })
      .limit(10)
    setCandidatosCons((data ?? []) as ConsentimientoResumen[])
  }

  async function vincular(atencionId: string, cons: ConsentimientoResumen) {
    await actualizarAt(atencionId, { consentimiento_id: cons.id, estado: 'en_curso' })
    setVinculando(null)
  }

  // --- Completar ---
  async function completar(a: AtencionFull) {
    const precio = Number(cierreForm.precio)
    if (!precio) { alert('Ingresa el precio final'); return }
    const pct = Number(cierreForm.comision_pct) || 0
    const comision = Math.round(precio * pct / 100)
    await actualizarAt(a.id, {
      estado: 'completada',
      fin: new Date().toISOString(),
      precio_final: precio,
      metodo_pago: cierreForm.metodo,
      comision_estudio: comision,
      monto_tatuador: precio - comision,
    })
    if (a.cotizacion_id) {
      await supabase.from('cotizaciones').update({ estado: 'atendida' }).eq('id', a.cotizacion_id)
    }
    setCompletando(null)
  }

  // --- Cancelar / no show ---
  async function cancelar(a: AtencionFull) {
    await actualizarAt(a.id, {
      estado: 'cancelada',
      cancelada_en: new Date().toISOString(),
      cancelada_por: cancelaForm.por as Atencion['cancelada_por'],
      motivo_cancelacion: cancelaForm.motivo.trim() || null,
    })
    setCancelando(null)
    setCancelaForm({ por: 'cliente', motivo: '' })
  }

  function nombreTat(id: string): string {
    const t = tatuadores.find(x => x.id === id)
    return t ? (t.nombre_artistico || t.nombre) : '?'
  }

  function nombrePuesto(id: string | null): string {
    return puestos.find(p => p.id === id)?.nombre ?? ''
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 18 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <h1>Atenciones</h1>
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
        <button onClick={() => setMostrarForm(!mostrarForm)}>
          {mostrarForm ? 'Cerrar' : '+ Atención directa'}
        </button>
      </div>

      {mostrarForm && (
        <div className="card" style={{ marginBottom: 18 }}>
          <h3 style={{ marginBottom: 4 }}>Atención directa (walk-in, sin cotización)</h3>
          <p style={{ color: 'var(--text3)', fontSize: '0.8rem', marginBottom: 12 }}>
            Para agendar desde una cotización aceptada, usa el botón &quot;Agendar atención&quot; en Cotizaciones.
          </p>
          <div className="fila-form" style={{ marginBottom: 12 }}>
            <div style={{ minWidth: 220 }}>
              <label>Cliente</label>
              {clienteSel ? (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span className="pill ok">{clienteSel.nombre}</span>
                  <button className="chico secundario" onClick={() => setClienteSel(null)}>✕</button>
                </div>
              ) : (
                <>
                  <input value={busquedaCliente} placeholder="Buscar por nombre o RUT…"
                    onChange={e => setBusquedaCliente(e.target.value)} />
                  {resultadosCliente.length > 0 && (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                      {resultadosCliente.map(c => (
                        <button key={c.id} className="chico secundario" onClick={() => {
                          setClienteSel(c); setBusquedaCliente(''); setResultadosCliente([])
                        }}>
                          {c.nombre} · {formatRut(c.rut)}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
            <div>
              <label>Tatuador</label>
              <select value={nuevo.tatuador_id} onChange={e => setNuevo({ ...nuevo, tatuador_id: e.target.value })}>
                <option value="">—</option>
                {tatuadores.filter(t => t.en_sistema).map(t => (
                  <option key={t.id} value={t.id}>{t.nombre_artistico || t.nombre}</option>
                ))}
              </select>
            </div>
            <div>
              <label>Puesto</label>
              <select value={nuevo.puesto_id} onChange={e => setNuevo({ ...nuevo, puesto_id: e.target.value })}>
                <option value="">—</option>
                {puestos.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
              </select>
            </div>
            <div>
              <label>Fecha</label>
              <input type="date" value={nuevo.fecha} onChange={e => setNuevo({ ...nuevo, fecha: e.target.value })} />
            </div>
            <div>
              <label>Hora</label>
              <input type="time" value={nuevo.hora} onChange={e => setNuevo({ ...nuevo, hora: e.target.value })} />
            </div>
          </div>
          <button onClick={crearAtencion}>Crear atención</button>
        </div>
      )}

      {loading ? <div className="spinner" /> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {atenciones.map(a => (
            <div key={a.id} className="card" style={{ padding: 14 }}>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
                <strong>
                  {new Date(a.inicio).toLocaleDateString('es-CL', { weekday: 'short', day: '2-digit', month: 'short' })}
                  {' '}{new Date(a.inicio).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}
                </strong>
                <span className={`pill ${a.estado === 'completada' ? 'ok' : a.estado === 'en_curso' ? 'alerta' : ['cancelada', 'no_show'].includes(a.estado) ? 'peligro' : ''}`}>
                  {ESTADO_LABEL[a.estado]}
                </span>
                <span>{a.cliente?.nombre ?? 'Sin cliente registrado'}</span>
                <span className="pill">{nombreTat(a.tatuador_id)}</span>
                {a.puesto_id && <span className="pill">{nombrePuesto(a.puesto_id)}</span>}
                {a.consentimiento_id
                  ? <span className="pill ok">Consentimiento ✓</span>
                  : a.estado === 'agendada' && <span className="pill alerta">Sin consentimiento</span>}
                {a.precio_final != null && <strong style={{ marginLeft: 'auto' }}>{formatCLP(a.precio_final)}</strong>}
              </div>

              {/* Acciones según estado */}
              {a.estado === 'agendada' && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <button className="chico" onClick={() => abrirVinculo(a)}>
                    ✍ Cliente firmó — vincular consentimiento
                  </button>
                  <button className="chico secundario" onClick={() => { setCancelando(a.id); setCancelaForm({ por: 'cliente', motivo: '' }) }}>
                    Cancelar
                  </button>
                  <button className="chico secundario" onClick={() => {
                    if (confirm('¿Marcar que el cliente no llegó?')) {
                      actualizarAt(a.id, { estado: 'no_show', cancelada_en: new Date().toISOString(), cancelada_por: 'cliente' })
                    }
                  }}>No llegó</button>
                </div>
              )}

              {a.estado === 'en_curso' && (
                completando === a.id ? (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    <input type="number" placeholder="Precio final CLP" value={cierreForm.precio}
                      onChange={e => setCierreForm({ ...cierreForm, precio: e.target.value })} style={{ width: 150 }} />
                    <select value={cierreForm.metodo}
                      onChange={e => setCierreForm({ ...cierreForm, metodo: e.target.value })} style={{ width: 140 }}>
                      <option value="efectivo">Efectivo</option>
                      <option value="transferencia">Transferencia</option>
                      <option value="tarjeta">Tarjeta</option>
                      <option value="otro">Otro</option>
                    </select>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.85rem', color: 'var(--text2)' }}>
                      Comisión estudio
                      <input type="number" value={cierreForm.comision_pct}
                        onChange={e => setCierreForm({ ...cierreForm, comision_pct: e.target.value })}
                        style={{ width: 60 }} />%
                    </span>
                    {cierreForm.precio && (
                      <span style={{ fontSize: '0.82rem', color: 'var(--text3)' }}>
                        Estudio {formatCLP(Math.round(Number(cierreForm.precio) * (Number(cierreForm.comision_pct) || 0) / 100))}
                        {' · '}Tatuador {formatCLP(Number(cierreForm.precio) - Math.round(Number(cierreForm.precio) * (Number(cierreForm.comision_pct) || 0) / 100))}
                      </span>
                    )}
                    <button className="chico" onClick={() => completar(a)}>Confirmar cierre</button>
                    <button className="chico secundario" onClick={() => setCompletando(null)}>✕</button>
                  </div>
                ) : (
                  <button className="chico" onClick={() => {
                    setCompletando(a.id)
                    setCierreForm({ precio: String(a.precio_final ?? ''), metodo: 'efectivo', comision_pct: '30' })
                  }}>
                    ✓ Completar atención
                  </button>
                )
              )}

              {a.estado === 'completada' && (
                <div style={{ fontSize: '0.82rem', color: 'var(--text3)' }}>
                  {a.metodo_pago && <>Pago: {a.metodo_pago} · </>}
                  {a.comision_estudio != null && <>Estudio {formatCLP(a.comision_estudio)} · Tatuador {formatCLP(a.monto_tatuador)}</>}
                </div>
              )}

              {['cancelada', 'no_show'].includes(a.estado) && (
                <div style={{ fontSize: '0.82rem', color: 'var(--text3)' }}>
                  {a.cancelada_por && <>Por: {a.cancelada_por}</>}
                  {a.motivo_cancelacion && <> · {a.motivo_cancelacion}</>}
                </div>
              )}

              {/* Formulario cancelación */}
              {cancelando === a.id && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 8 }}>
                  <select value={cancelaForm.por}
                    onChange={e => setCancelaForm({ ...cancelaForm, por: e.target.value })} style={{ width: 130 }}>
                    <option value="cliente">Canceló cliente</option>
                    <option value="tatuador">Canceló tatuador</option>
                    <option value="estudio">Canceló estudio</option>
                  </select>
                  <input value={cancelaForm.motivo} placeholder="Motivo"
                    onChange={e => setCancelaForm({ ...cancelaForm, motivo: e.target.value })} style={{ width: 220 }} />
                  <button className="chico" style={{ background: 'var(--rojo)' }} onClick={() => cancelar(a)}>Confirmar cancelación</button>
                  <button className="chico secundario" onClick={() => setCancelando(null)}>✕</button>
                </div>
              )}

              {/* Selector de consentimiento */}
              {vinculando === a.id && (
                <div style={{ marginTop: 10, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
                    <label style={{ margin: 0 }}>Consentimientos recientes (48h)</label>
                    <input value={buscaFolio} placeholder="o buscar folio…"
                      onChange={e => setBuscaFolio(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && buscarPorFolio()}
                      style={{ width: 160 }} />
                    <button className="chico secundario" onClick={buscarPorFolio}>Buscar</button>
                    <button className="chico secundario" onClick={() => setVinculando(null)}>✕</button>
                  </div>
                  {candidatosCons.length === 0 ? (
                    <p style={{ color: 'var(--text3)', fontSize: '0.85rem' }}>
                      No hay consentimientos recientes. El cliente debe firmar primero en la app de consentimientos.
                    </p>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {candidatosCons.map(cons => {
                        const coincide = a.cliente?.rut && normalizarRut(cons.rut) === a.cliente.rut
                        return (
                          <div key={cons.id} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: '0.87rem' }}>
                            <button className="chico" onClick={() => vincular(a.id, cons)}>Vincular</button>
                            <strong>{cons.folio}</strong>
                            <span>{cons.nombre}</span>
                            <span style={{ color: 'var(--text3)' }}>{formatRut(cons.rut)}</span>
                            <span className={`pill ${cons.estado === 'firmado' ? 'ok' : ''}`}>{cons.estado}</span>
                            {coincide && <span className="pill ok">RUT coincide ✓</span>}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
          {atenciones.length === 0 && (
            <div className="vacio">
              {tab === 'hoy' ? 'Sin atenciones para hoy.' : tab === 'proximas' ? 'Sin atenciones agendadas a futuro.' : 'Sin atenciones este mes.'}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
