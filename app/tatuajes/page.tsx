'use client'
// "Mis tatuajes" (tatuador) / "Registro Tatuajes" (admin y recepción):
// una sola sección con dos pestañas — Proyectos de tatuaje y Sesiones.
import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import {
  Proyecto, Sesion, Cliente, Estilo, Tatuador, Puesto, PuestoTitular,
  SESION_ESTADO_LABEL, SesionEstado, formatCLP,
} from '@/lib/types'
import { useSesion } from '@/lib/sesion'
import { aplicarReglas24h } from '@/lib/sesiones'
import { MoneyInput, MoneyCell } from '@/components/money'
import FormTatuaje from '@/components/FormTatuaje'
import SesionCard, { SesionFull } from '@/components/SesionCard'
import { SelectorPuesto, parsePuestoSel, asegurarReserva, sugerirAbono } from '@/components/agendar'

type ProyectoFull = Proyecto & { cliente: Cliente | null; sesiones: Sesion[] }

const PILL_ESTADO: Record<SesionEstado, string> = {
  espera_consentimiento: 'alerta',
  consentimiento_firmado: 'ok',
  completada: 'ok',
  incompleta: 'alerta',
  cancelada: 'peligro',
}

function hoyISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ════════════════ Pestaña: Proyectos de tatuaje ════════════════

function ProyectosTab() {
  const { sesion } = useSesion()
  const esTatuador = sesion?.rol === 'tatuador'
  const miId = sesion?.tatuadorId ?? null
  const rol = sesion?.rol ?? 'admin'

  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'activos' | 'cerrados'>('activos')
  const [proyectos, setProyectos] = useState<ProyectoFull[]>([])
  const [estilos, setEstilos] = useState<Estilo[]>([])
  const [tatuadores, setTatuadores] = useState<Tatuador[]>([])
  const [puestos, setPuestos] = useState<Puesto[]>([])
  const [titulares, setTitulares] = useState<PuestoTitular[]>([])
  const [abiertoId, setAbiertoId] = useState<string | null>(null)
  const [mostrarForm, setMostrarForm] = useState(false)

  // Agregar sesión a proyecto existente
  const [agregandoSesion, setAgregandoSesion] = useState<string | null>(null)
  const [sesionForm, setSesionForm] = useState({ fecha: '', hora: '12:00', puesto: '', valor: '', abono: '', abonado: false })

  // Editar datos del proyecto (descripción/zona/estilo se bloquean tras
  // la primera firma de consentimiento)
  const [editando, setEditando] = useState<string | null>(null)
  const [editForm, setEditForm] = useState({ descripcion: '', estilo_id: '', zona: '', tamano: '', a_color: false, comentarios: '' })

  const cargar = useCallback(async () => {
    setLoading(true)
    let q = supabase.from('proyectos')
      .select('*, cliente:clientes(*), sesiones(*)')
      .order('created_at', { ascending: false })
      .limit(100)
    q = tab === 'activos' ? q.eq('estado', 'activo') : q.in('estado', ['completado', 'cancelado'])
    if (esTatuador && miId) q = q.eq('tatuador_id', miId)
    const [p, e, t, pu, ti] = await Promise.all([
      q,
      supabase.from('estilos').select('*').eq('activo', true).order('orden'),
      supabase.from('tatuadores').select('*'),
      supabase.from('puestos').select('*').eq('activo', true).eq('gestionado', true).order('orden'),
      supabase.from('puesto_titulares').select('*'),
    ])
    const lista = (p.data as ProyectoFull[]) ?? []
    for (const pr of lista) {
      pr.sesiones = await aplicarReglas24h(pr.sesiones ?? [])
      pr.sesiones.sort((a, b) => a.inicio.localeCompare(b.inicio))
    }
    setProyectos(lista)
    setEstilos(e.data ?? [])
    setTatuadores((t.data as Tatuador[]) ?? [])
    setPuestos(pu.data ?? [])
    setTitulares(ti.data ?? [])
    setLoading(false)
  }, [tab, esTatuador, miId])

  useEffect(() => { cargar() }, [cargar])

  async function agregarSesion(p: ProyectoFull) {
    if (!sesionForm.fecha) { alert('Falta la fecha'); return }
    if (esTatuador && !sesionForm.puesto) { alert('Elige un puesto disponible'); return }
    const { puestoId, bloque } = parsePuestoSel(sesionForm.puesto)
    if (puestoId) {
      const ok = await asegurarReserva({
        puestos, puestoId, bloqueForzado: bloque,
        fecha: sesionForm.fecha, hora: sesionForm.hora, tatuadorId: p.tatuador_id, rol,
      })
      if (!ok) return
    }
    const { error } = await supabase.from('sesiones').insert({
      proyecto_id: p.id,
      tatuador_id: p.tatuador_id,
      numero: (p.sesiones?.length ?? 0) + 1,
      inicio: new Date(`${sesionForm.fecha}T${sesionForm.hora}:00`).toISOString(),
      puesto_id: puestoId || null,
      valor: sesionForm.valor ? Number(sesionForm.valor) : 0,
      abono: sesionForm.abono ? Number(sesionForm.abono) : 0,
      abonado: sesionForm.abonado,
    })
    if (error) { alert('Error: ' + error.message); return }
    setAgregandoSesion(null)
    cargar()
  }

  async function actualizarSesion(id: string, cambios: Partial<Sesion>) {
    setProyectos(ps => ps.map(p => ({
      ...p, sesiones: p.sesiones.map(s => s.id === id ? { ...s, ...cambios } : s),
    })))
    await supabase.from('sesiones')
      .update({ ...cambios, updated_at: new Date().toISOString() }).eq('id', id)
  }

  async function actualizarProyecto(id: string, cambios: Partial<Proyecto>) {
    setProyectos(ps => ps.map(p => p.id === id ? { ...p, ...cambios } : p))
    await supabase.from('proyectos')
      .update({ ...cambios, updated_at: new Date().toISOString() }).eq('id', id)
  }

  async function cancelarProyecto(p: ProyectoFull) {
    if (!confirm('¿Cancelar este proyecto? Sus sesiones pendientes también se cancelarán.')) return
    await supabase.from('sesiones')
      .update({ estado: 'cancelada', observacion: 'Proyecto cancelado', updated_at: new Date().toISOString() })
      .eq('proyecto_id', p.id)
      .in('estado', ['espera_consentimiento', 'consentimiento_firmado'])
    await actualizarProyecto(p.id, { estado: 'cancelado' })
    cargar()
  }

  function nombreTat(id: string): string {
    const t = tatuadores.find(x => x.id === id)
    return t ? (t.nombre_artistico || t.nombre) : '?'
  }

  function nombreEstilo(id: string | null): string {
    return estilos.find(e => e.id === id)?.nombre ?? ''
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className={`chico ${tab === 'activos' ? '' : 'secundario'}`} onClick={() => setTab('activos')}>Activos</button>
          <button className={`chico ${tab === 'cerrados' ? '' : 'secundario'}`} onClick={() => setTab('cerrados')}>Cerrados</button>
        </div>
        <button onClick={() => setMostrarForm(!mostrarForm)}>
          {mostrarForm ? 'Cerrar' : 'Agendar Tatuaje'}
        </button>
      </div>

      {mostrarForm && (
        <div style={{ marginBottom: 18 }}>
          <FormTatuaje onDone={() => { setMostrarForm(false); setTab('activos'); cargar() }}
            onCancel={() => setMostrarForm(false)} />
        </div>
      )}

      {loading ? <div className="spinner" /> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {proyectos.map(p => {
            const totalProyecto = p.sesiones.reduce((s, x) => s + (x.valor ?? 0), 0)
            const totalAbonado = p.sesiones.reduce((s, x) => s + (x.abonado ? (x.abono ?? 0) : 0), 0)
            const expandido = abiertoId === p.id
            return (
              <div key={p.id} className="card" style={{ padding: 14 }}>
                <div onClick={() => setAbiertoId(expandido ? null : p.id)}
                  style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', cursor: 'pointer' }}>
                  <strong>{p.folio}</strong>
                  <span>{p.cliente?.nombre ?? '—'}</span>
                  {!esTatuador && <span className="pill">{nombreTat(p.tatuador_id)}</span>}
                  {p.estilo_id && <span className="pill">{nombreEstilo(p.estilo_id)}{p.a_color ? ' · color' : ''}</span>}
                  {p.desde_okami && <span className="pill alerta">Desde Okami</span>}
                  <span className="pill">{p.sesiones.length} sesión{p.sesiones.length !== 1 ? 'es' : ''}</span>
                  <span style={{ marginLeft: 'auto', fontSize: 13, color: 'var(--text2)' }}>
                    {formatCLP(totalAbonado)} / {formatCLP(totalProyecto)}
                  </span>
                  <span style={{ color: 'var(--text3)' }}>{expandido ? '▲' : '▼'}</span>
                </div>

                {expandido && (
                  <div style={{ marginTop: 12 }}>
                    {editando === p.id ? (() => {
                      const bloqueado = p.sesiones.some(s => s.consentimiento_firmado_en)
                      const lockStyle = bloqueado
                        ? { background: 'var(--bg2)', color: 'var(--text2)' } : undefined
                      return (
                        <div style={{ marginBottom: 14 }}>
                          {bloqueado && (
                            <div className="banner warning" style={{ marginBottom: 10 }}>
                              Ya hay un consentimiento firmado: descripción, zona y estilo no se pueden editar.
                              Las condiciones médicas se registran en el consentimiento de cada sesión.
                            </div>
                          )}
                          <label>Descripción del proyecto *</label>
                          <textarea rows={2} value={editForm.descripcion} readOnly={bloqueado} style={lockStyle}
                            onChange={e => setEditForm({ ...editForm, descripcion: e.target.value })} />
                          <div className="fila-form" style={{ marginTop: 10 }}>
                            <div>
                              <label>Estilo *</label>
                              <select value={editForm.estilo_id} disabled={bloqueado}
                                onChange={e => setEditForm({ ...editForm, estilo_id: e.target.value })}>
                                <option value="">—</option>
                                {estilos.map(e => <option key={e.id} value={e.id}>{e.nombre}</option>)}
                              </select>
                            </div>
                            <div>
                              <label>Lugar del cuerpo *</label>
                              <input value={editForm.zona} readOnly={bloqueado} style={lockStyle}
                                onChange={e => setEditForm({ ...editForm, zona: e.target.value })} />
                            </div>
                            <div>
                              <label>Tamaño</label>
                              <input value={editForm.tamano}
                                onChange={e => setEditForm({ ...editForm, tamano: e.target.value })} />
                            </div>
                            <div style={{ display: 'flex', alignItems: 'flex-end', minWidth: 90 }}>
                              <label style={{ display: 'flex', alignItems: 'center', gap: 6, margin: 0, cursor: 'pointer', color: 'var(--text)', fontSize: 13 }}>
                                <input type="checkbox" checked={editForm.a_color} style={{ width: 'auto' }}
                                  onChange={e => setEditForm({ ...editForm, a_color: e.target.checked })} />
                                A color
                              </label>
                            </div>
                          </div>
                          <label style={{ marginTop: 10 }}>Condiciones médicas y comentarios</label>
                          <input value={editForm.comentarios}
                            onChange={e => setEditForm({ ...editForm, comentarios: e.target.value })} />
                          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                            <button className="chico" onClick={async () => {
                              if (!bloqueado && !editForm.descripcion.trim()) { alert('La descripción es obligatoria'); return }
                              if (!bloqueado && !editForm.zona.trim()) { alert('El lugar del cuerpo es obligatorio'); return }
                              const cambios: Partial<Proyecto> = {
                                tamano: editForm.tamano.trim() || null,
                                a_color: editForm.a_color,
                                comentarios: editForm.comentarios.trim() || null,
                              }
                              if (!bloqueado) {
                                cambios.descripcion = editForm.descripcion.trim()
                                cambios.estilo_id = editForm.estilo_id || null
                                cambios.zona = editForm.zona.trim() || null
                              }
                              await actualizarProyecto(p.id, cambios)
                              setEditando(null)
                            }}>Guardar cambios</button>
                            <button className="chico secundario" onClick={() => setEditando(null)}>✕ Cancelar</button>
                          </div>
                        </div>
                      )
                    })() : (
                      <>
                        <p style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 4 }}>{p.descripcion}</p>
                        <p style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 8 }}>
                          {[p.zona, p.tamano, p.comentarios].filter(Boolean).join(' · ')}
                        </p>
                        <button className="chico secundario" style={{ marginBottom: 12 }} onClick={() => {
                          setEditando(p.id)
                          setEditForm({
                            descripcion: p.descripcion ?? '',
                            estilo_id: p.estilo_id ?? '',
                            zona: p.zona ?? '',
                            tamano: p.tamano ?? '',
                            a_color: !!p.a_color,
                            comentarios: p.comentarios ?? '',
                          })
                        }}>✎ Editar proyecto</button>
                      </>
                    )}

                    <table style={{ marginBottom: 10 }}>
                      <thead>
                        <tr><th>#</th><th>Fecha</th><th>Valor</th><th>Abono</th><th>Abonado</th><th>Estado</th></tr>
                      </thead>
                      <tbody>
                        {p.sesiones.map(s => (
                          <tr key={s.id}>
                            <td>{s.numero}</td>
                            <td>{new Date(s.inicio).toLocaleDateString('es-CL', { day: '2-digit', month: 'short' })}
                              {' '}{new Date(s.inicio).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}</td>
                            <td><MoneyCell initial={s.valor} onCommit={v => actualizarSesion(s.id, { valor: v })} /></td>
                            <td><MoneyCell initial={s.abono} onCommit={v => actualizarSesion(s.id, { abono: v })} style={{ width: 90, padding: '3px 6px' }} /></td>
                            <td>
                              <input type="checkbox" checked={s.abonado} style={{ width: 'auto' }}
                                onChange={e => actualizarSesion(s.id, { abonado: e.target.checked })} />
                            </td>
                            <td>
                              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                                <span className={`pill ${PILL_ESTADO[s.estado]}`}>{SESION_ESTADO_LABEL[s.estado]}</span>
                                {s.estado === 'consentimiento_firmado' && (
                                  <>
                                    <button className="chico" onClick={() => actualizarSesion(s.id, { estado: 'completada' })}>Completa</button>
                                    <button className="chico secundario" onClick={() => actualizarSesion(s.id, { estado: 'incompleta' })}>Incompleta</button>
                                  </>
                                )}
                                {['espera_consentimiento', 'consentimiento_firmado'].includes(s.estado) && (
                                  <button className="chico secundario" onClick={() => {
                                    if (confirm('¿Cancelar esta sesión?')) actualizarSesion(s.id, { estado: 'cancelada' })
                                  }}>Cancelar sesión</button>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    <div style={{ fontSize: 13, marginBottom: 12 }}>
                      <strong>Total abonado {formatCLP(totalAbonado)} · Total proyecto {formatCLP(totalProyecto)}</strong>
                    </div>

                    {agregandoSesion === p.id ? (
                      <div className="fila-form" style={{ alignItems: 'flex-end' }}>
                        <div><label>Fecha</label>
                          <input type="date" value={sesionForm.fecha}
                            onChange={e => setSesionForm({ ...sesionForm, fecha: e.target.value, puesto: '' })} /></div>
                        <div><label>Hora</label>
                          <input type="time" value={sesionForm.hora} onChange={e => setSesionForm({ ...sesionForm, hora: e.target.value })} /></div>
                        <div><label>Puesto</label>
                          <SelectorPuesto fecha={sesionForm.fecha} value={sesionForm.puesto}
                            onChange={v => setSesionForm(f => ({ ...f, puesto: v }))}
                            puestos={puestos} titulares={titulares} tatuadores={tatuadores} /></div>
                        <div><label>Valor</label>
                          <MoneyInput value={sesionForm.valor} placeholder="$150.000"
                            onChange={v => setSesionForm({ ...sesionForm, valor: v, abono: sugerirAbono(v) })} /></div>
                        <div><label>Abono</label>
                          <MoneyInput value={sesionForm.abono} onChange={v => setSesionForm({ ...sesionForm, abono: v })} /></div>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button className="chico" onClick={() => agregarSesion(p)}>Agregar</button>
                          <button className="chico secundario" onClick={() => setAgregandoSesion(null)}>✕</button>
                        </div>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <button className="chico secundario" onClick={() => {
                          setAgregandoSesion(p.id)
                          setSesionForm({ fecha: '', hora: '12:00', puesto: '', valor: '', abono: '', abonado: false })
                        }}>+ Agregar sesión</button>
                        {p.estado === 'activo' ? (
                          <>
                            <button className="chico secundario" onClick={() => actualizarProyecto(p.id, { estado: 'completado' })}>
                              Marcar proyecto completado
                            </button>
                            <button className="chico secundario" onClick={() => cancelarProyecto(p)}>
                              Cancelar proyecto
                            </button>
                          </>
                        ) : (
                          <button className="chico secundario" onClick={() => actualizarProyecto(p.id, { estado: 'activo' })}>
                            Reabrir proyecto
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
          {proyectos.length === 0 && (
            <div className="vacio">Sin proyectos {tab === 'activos' ? 'activos' : 'cerrados'}.</div>
          )}
        </div>
      )}
    </div>
  )
}

// ════════════════ Pestaña: Sesiones ════════════════

function SesionesTab() {
  const { sesion } = useSesion()
  const esTatuador = sesion?.rol === 'tatuador'
  const miId = sesion?.tatuadorId ?? null

  const [vista, setVista] = useState<'proximamente' | 'historial'>('proximamente')
  const [mes, setMes] = useState(hoyISO().slice(0, 7))
  const [loading, setLoading] = useState(true)
  const [sesionesHoy, setSesionesHoy] = useState<SesionFull[]>([])
  const [sesionesProx, setSesionesProx] = useState<SesionFull[]>([])
  const [sesionesHist, setSesionesHist] = useState<SesionFull[]>([])
  const [tatuadores, setTatuadores] = useState<Tatuador[]>([])

  const cargar = useCallback(async () => {
    setLoading(true)
    const hoy = hoyISO()
    const base = () => {
      let q = supabase.from('sesiones').select('*, proyecto:proyectos(*, cliente:clientes(*))')
      if (esTatuador && miId) q = q.eq('tatuador_id', miId)
      return q
    }
    const { data: tats } = await supabase.from('tatuadores').select('*')
    setTatuadores((tats as Tatuador[]) ?? [])
    if (vista === 'proximamente') {
      const [h, p] = await Promise.all([
        base().gte('inicio', `${hoy}T00:00:00`).lte('inicio', `${hoy}T23:59:59`)
          .order('inicio', { ascending: true }),
        base().gt('inicio', `${hoy}T23:59:59`)
          .in('estado', ['espera_consentimiento'])
          .order('inicio', { ascending: true }).limit(100),
      ])
      setSesionesHoy(await aplicarReglas24h((h.data as SesionFull[]) ?? []))
      setSesionesProx(await aplicarReglas24h((p.data as SesionFull[]) ?? []))
    } else {
      const [anio, mesNum] = mes.split('-').map(Number)
      const hasta = new Date(anio, mesNum, 1).toISOString()
      const { data } = await base()
        .gte('inicio', `${mes}-01T00:00:00`).lt('inicio', hasta)
        .order('inicio', { ascending: false })
      setSesionesHist(await aplicarReglas24h((data as SesionFull[]) ?? []))
    }
    setLoading(false)
  }, [vista, mes, esTatuador, miId])

  useEffect(() => { cargar() }, [cargar])

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 16 }}>
        <button className={`chico ${vista === 'proximamente' ? '' : 'secundario'}`} onClick={() => setVista('proximamente')}>Próximamente</button>
        <button className={`chico ${vista === 'historial' ? '' : 'secundario'}`} onClick={() => setVista('historial')}>Historial</button>
        {vista === 'historial' && (
          <input type="month" value={mes} onChange={e => e.target.value && setMes(e.target.value)}
            style={{ width: 160 }} />
        )}
      </div>

      {loading ? <div className="spinner" /> : vista === 'proximamente' ? (
        <>
          <div className="section-title">Hoy</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
            {sesionesHoy.map(s => <SesionCard key={s.id} s={s} tatuadores={tatuadores} onChanged={cargar} />)}
            {sesionesHoy.length === 0 && <div className="vacio" style={{ padding: 16 }}>Sin sesiones para hoy.</div>}
          </div>
          <div className="section-title">Próximas</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {sesionesProx.map(s => <SesionCard key={s.id} s={s} tatuadores={tatuadores} onChanged={cargar} />)}
            {sesionesProx.length === 0 && <div className="vacio" style={{ padding: 16 }}>Sin sesiones futuras agendadas.</div>}
          </div>
        </>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {sesionesHist.map(s => <SesionCard key={s.id} s={s} tatuadores={tatuadores} onChanged={cargar} />)}
          {sesionesHist.length === 0 && <div className="vacio">Sin sesiones este mes.</div>}
        </div>
      )}
    </div>
  )
}

// ════════════════ Página ════════════════

export default function TatuajesPage() {
  const { sesion } = useSesion()
  const esTatuador = sesion?.rol === 'tatuador'
  const [tab, setTab] = useState<'proyectos' | 'sesiones'>('proyectos')

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 18 }}>
        <h1>{esTatuador ? 'Mis tatuajes' : 'Registro Tatuajes'}</h1>
        <button className={`chico ${tab === 'proyectos' ? '' : 'secundario'}`} onClick={() => setTab('proyectos')}>
          Proyectos de tatuaje
        </button>
        <button className={`chico ${tab === 'sesiones' ? '' : 'secundario'}`} onClick={() => setTab('sesiones')}>
          Sesiones
        </button>
      </div>
      {tab === 'proyectos' ? <ProyectosTab /> : <SesionesTab />}
    </div>
  )
}
