'use client'
// "Agendar Proyecto": un proyecto de tatuaje completo con 1..N sesiones.
// Host/admin agendan a tatuadores que reciben cotizaciones del estudio
// (desde_okami = true). Los tatuadores solo se agendan a sí mismos y solo
// ven a sus propios clientes; marcan manualmente si vino de Okami.
import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import {
  Proyecto, Sesion, Cliente, Estilo, Tatuador, Puesto, PuestoTitular,
  SESION_ESTADO_LABEL, SesionEstado, formatCLP, formatRut, normalizarRut,
} from '@/lib/types'
import { useSesion } from '@/lib/sesion'
import { aplicarReglas24h } from '@/lib/sesiones'
import { Reserva, bloqueDesdeHora, crearReserva } from '@/lib/reservas'
import { MoneyInput, MoneyCell } from '@/components/money'

type ProyectoFull = Proyecto & { cliente: Cliente | null; sesiones: Sesion[] }

const PILL_ESTADO: Record<SesionEstado, string> = {
  espera_consentimiento: 'alerta',
  consentimiento_firmado: 'ok',
  completada: 'ok',
  incompleta: 'alerta',
  cancelada: 'peligro',
}

interface NuevoProyecto {
  cliente_id: string | null
  nuevo_nombre: string
  nuevo_telefono: string
  nuevo_instagram: string
  nuevo_email: string
  descripcion: string
  estilo_id: string
  a_color: boolean
  zona: string
  tamano: string
  comentarios: string
  tatuador_id: string
  desde_okami: boolean
  // Primera sesión (mínimo una)
  fecha: string
  hora: string
  puesto_id: string
  valor: string
  abono: string
  abonado: boolean
}

const NUEVO_VACIO: NuevoProyecto = {
  cliente_id: null, nuevo_nombre: '', nuevo_telefono: '', nuevo_instagram: '', nuevo_email: '',
  descripcion: '', estilo_id: '', a_color: false, zona: '', tamano: '', comentarios: '',
  tatuador_id: '', desde_okami: false,
  fecha: '', hora: '12:00', puesto_id: '', valor: '', abono: '', abonado: false,
}

export default function ProyectosPage() {
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
  // Reservas activas por fecha (para los cupos rotativos)
  const [reservasFecha, setReservasFecha] = useState<Record<string, Reserva[]>>({})

  // Formulario nuevo proyecto
  const [mostrarForm, setMostrarForm] = useState(false)
  const [nuevo, setNuevo] = useState<NuevoProyecto>(NUEVO_VACIO)
  const [busquedaCliente, setBusquedaCliente] = useState('')
  const [resultadosCliente, setResultadosCliente] = useState<Cliente[]>([])
  const [clienteSel, setClienteSel] = useState<Cliente | null>(null)
  const [modoCliente, setModoCliente] = useState<'' | 'nuevo' | 'registrado'>('')
  const [guardando, setGuardando] = useState(false)

  // Agregar sesión a proyecto existente
  const [agregandoSesion, setAgregandoSesion] = useState<string | null>(null)
  const [sesionForm, setSesionForm] = useState({ fecha: '', hora: '12:00', puesto_id: '', valor: '', abono: '', abonado: false })

  const cargar = useCallback(async () => {
    setLoading(true)
    let q = supabase.from('proyectos')
      .select('*, cliente:clientes(*), sesiones(*)')
      .eq('estado', tab === 'activos' ? 'activo' : tab)
      .order('created_at', { ascending: false })
      .limit(100)
    if (tab === 'cerrados') {
      q = supabase.from('proyectos')
        .select('*, cliente:clientes(*), sesiones(*)')
        .in('estado', ['completado', 'cancelado'])
        .order('created_at', { ascending: false })
        .limit(100)
    }
    if (esTatuador && miId) q = q.eq('tatuador_id', miId)
    const [p, e, t, pu, ti] = await Promise.all([
      q,
      supabase.from('estilos').select('*').eq('activo', true).order('orden'),
      supabase.from('tatuadores').select('*').eq('activo', true),
      supabase.from('puestos').select('*').eq('activo', true).eq('gestionado', true).order('orden'),
      supabase.from('puesto_titulares').select('*'),
    ])
    let lista = (p.data as ProyectoFull[]) ?? []
    // Reglas 24h sobre las sesiones cargadas
    for (const pr of lista) {
      pr.sesiones = await aplicarReglas24h(pr.sesiones ?? [])
      pr.sesiones.sort((a, b) => a.inicio.localeCompare(b.inicio))
    }
    setProyectos(lista)
    setEstilos(e.data ?? [])
    setTatuadores((t.data ?? []).filter((x: Tatuador) => !x.archivado && !x.eliminado))
    setPuestos(pu.data ?? [])
    setTitulares(ti.data ?? [])
    setLoading(false)
  }, [tab, esTatuador, miId])

  useEffect(() => { cargar() }, [cargar])

  // Búsqueda de cliente (tatuador: solo los suyos)
  useEffect(() => {
    const q = busquedaCliente.trim()
    if (q.length < 2) { setResultadosCliente([]); return }
    const timer = setTimeout(async () => {
      let query = supabase.from('clientes').select('*').limit(6)
      if (esTatuador && miId) query = query.eq('tatuador_id', miId)
      const rutNorm = normalizarRut(q)
      if (rutNorm.length >= 5 && /^[0-9]+[0-9K]$/.test(rutNorm)) {
        query = query.ilike('rut', `${rutNorm}%`)
      } else {
        query = query.ilike('nombre', `%${q}%`)
      }
      const { data } = await query
      setResultadosCliente(data ?? [])
    }, 300)
    return () => clearTimeout(timer)
  }, [busquedaCliente, esTatuador, miId])

  // Abono sugerido: 50% del valor
  function sugerirAbono(valor: string): string {
    const v = Number(valor)
    return v > 0 ? String(Math.round(v / 2)) : ''
  }

  // ── Disponibilidad de puestos ──
  const miTipo = esTatuador
    ? (tatuadores.find(t => t.id === miId)?.tipo_puesto ?? 'rotativo')
    : null
  const miPuestoPropio = esTatuador
    ? puestos.find(p => titulares.some(t => t.tatuador_id === miId && t.puesto_id === p.id)) ?? null
    : null

  async function cargarReservasFecha(fecha: string) {
    if (!fecha || reservasFecha[fecha]) return
    const { data } = await supabase.from('reservas').select('*')
      .eq('fecha', fecha).eq('estado', 'activa')
    setReservasFecha(prev => ({ ...prev, [fecha]: (data as Reserva[]) ?? [] }))
  }

  // Cupos rotativos para una fecha: SOLO los que el tatuador ya reservó
  // en el Calendario (flujo: primero reservar, luego agendar). NO se
  // filtra por hora — se muestran todos los cupos reservados del día, y
  // el turno (fin de semana) va como etiqueta. El valor codifica el
  // bloque reservado (`puestoId::bloque`) para agendar sin depender de
  // la hora ingresada.
  function cuposRotativos(fecha: string): { id: string; label: string }[] {
    const rotativos = puestos.filter(p => p.tipo === 'rotativo')
    if (!fecha) return []
    const res = reservasFecha[fecha] ?? []
    const out: { id: string; label: string }[] = []
    rotativos.forEach((p, i) => {
      res.filter(x => x.puesto_id === p.id && x.tatuador_id === miId)
        .forEach(r => out.push({
          id: `${p.id}::${r.bloque}`,
          label: `Día ${i + 1}${r.bloque !== 'dia' ? ` (${r.bloque.toUpperCase()})` : ''}`,
        }))
    })
    return out
  }

  // Un valor de puesto puede venir como "puestoId::bloque" (cupo rotativo
  // ya reservado) o como puesto simple.
  function parsePuesto(v: string): { puestoId: string; bloque?: 'dia' | 'am' | 'pm' } {
    if (v.includes('::')) {
      const [p, b] = v.split('::')
      return { puestoId: p, bloque: b as 'dia' | 'am' | 'pm' }
    }
    return { puestoId: v }
  }

  // Crea/confirma la reserva que bloquea el puesto de la sesión.
  // Full: su puesto es propio, no requiere reserva.
  // bloqueForzado: turno del cupo ya reservado (rotativo); si no viene, se
  // deriva de la hora (findes) para puestos rotativos, o 'dia' para el resto.
  // Devuelve false si hay tope y el usuario no confirma (solo admin/host).
  async function asegurarReserva(
    tatuadorId: string, puestoId: string, fecha: string, hora: string,
    bloqueForzado?: 'dia' | 'am' | 'pm',
  ): Promise<boolean> {
    const p = puestos.find(x => x.id === puestoId)
    if (!p || p.tipo === 'full') return true
    const bloque = bloqueForzado ?? (p.tipo === 'rotativo' ? bloqueDesdeHora(fecha, hora) : 'dia')
    const { error } = await crearReserva({
      fecha,
      bloque,
      puesto_id: puestoId,
      tatuador_id: tatuadorId,
      creada_por: rol,
    })
    if (!error) {
      setReservasFecha(prev => { const c = { ...prev }; delete c[fecha]; return c })
      return true
    }
    if (!esTatuador) return confirm(`${error} ¿Crear la sesión de todos modos?`)
    alert(error)
    return false
  }

  // Selector de puesto según el rol:
  //  * tatuador full/compartido → su puesto propio (fijo)
  //  * tatuador rotativo/guest  → cupos "Día n" disponibles para la fecha
  //  * admin/host               → cualquier puesto
  function renderSelectorPuesto(fecha: string, hora: string, valor: string, onChange: (v: string) => void) {
    if (esTatuador && (miTipo === 'full' || miTipo === 'compartido')) {
      if (!miPuestoPropio) {
        return <span style={{ fontSize: 12, color: 'var(--danger-text)' }}>Sin puesto asignado — pide al admin que te asigne como titular</span>
      }
      return <input value={`${miPuestoPropio.nombre} (propio)`} readOnly
        style={{ background: 'var(--bg2)', color: 'var(--text2)', cursor: 'default' }} />
    }
    if (esTatuador) {
      const cupos = cuposRotativos(fecha)
      if (fecha && reservasFecha[fecha] && cupos.length === 0) {
        return (
          <span style={{ fontSize: 12, color: 'var(--danger-text)' }}>
            No hay puestos reservados para esa fecha — reserva primero en el Calendario
          </span>
        )
      }
      return (
        <select value={valor} onChange={e => onChange(e.target.value)} onFocus={() => cargarReservasFecha(fecha)}>
          <option value="">— elegir puesto reservado —</option>
          {cupos.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
      )
    }
    return (
      <select value={valor} onChange={e => onChange(e.target.value)}>
        <option value="">—</option>
        {puestos.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
      </select>
    )
  }

  async function crearProyecto() {
    const tatuadorId = esTatuador ? miId : nuevo.tatuador_id
    if (!tatuadorId) { alert('Falta el tatuador'); return }
    if (!clienteSel) {
      if (modoCliente === 'registrado') { alert('Busca y selecciona el cliente registrado'); return }
      if (modoCliente === 'nuevo' && !nuevo.nuevo_nombre.trim()) { alert('El nombre del cliente nuevo es obligatorio'); return }
      if (!modoCliente) { alert('Elige "Cliente nuevo" o "Cliente registrado" y asigna un cliente antes de crear el proyecto'); return }
    }
    if (!nuevo.descripcion.trim()) { alert('La descripción del proyecto es obligatoria'); return }
    if (!nuevo.fecha) { alert('La fecha de la primera sesión es obligatoria'); return }

    // Puesto: tatuadores full/compartido usan su puesto propio
    let puestoSel = nuevo.puesto_id
    if (esTatuador && (miTipo === 'full' || miTipo === 'compartido')) {
      puestoSel = miPuestoPropio?.id ?? ''
    }
    if (esTatuador && !puestoSel) { alert('Elige un cupo disponible para la sesión'); return }
    const { puestoId, bloque } = parsePuesto(puestoSel)

    setGuardando(true)
    // Bloquear el puesto (reserva) antes de agendar
    if (puestoId && tatuadorId) {
      const ok = await asegurarReserva(tatuadorId, puestoId, nuevo.fecha, nuevo.hora, bloque)
      if (!ok) { setGuardando(false); return }
    }
    const desdeOkami = esTatuador ? nuevo.desde_okami : true

    // Cliente: existente o provisorio nuevo (nombre + contacto opcional).
    // Propiedad: solo si lo agendó el tatuador directo (sin Okami).
    let clienteId = clienteSel?.id ?? null
    if (!clienteId) {
      const { data: cl, error: clErr } = await supabase.from('clientes').insert({
        nombre: nuevo.nuevo_nombre.trim(),
        telefono: nuevo.nuevo_telefono.trim() || null,
        instagram: nuevo.nuevo_instagram.trim() || null,
        email: nuevo.nuevo_email.trim() || null,
        tatuador_id: esTatuador && !desdeOkami ? miId : null,
      }).select('id').single()
      if (clErr) { alert('Error al crear cliente: ' + clErr.message); setGuardando(false); return }
      clienteId = cl!.id
    }

    const { data: folio } = await supabase.rpc('next_folio_proyecto')
    const { data: proyecto, error } = await supabase.from('proyectos').insert({
      folio,
      cliente_id: clienteId,
      tatuador_id: tatuadorId,
      creado_por: rol,
      desde_okami: desdeOkami,
      descripcion: nuevo.descripcion.trim(),
      estilo_id: nuevo.estilo_id || null,
      a_color: nuevo.a_color,
      zona: nuevo.zona.trim() || null,
      tamano: nuevo.tamano.trim() || null,
      comentarios: nuevo.comentarios.trim() || null,
    }).select('id').single()
    if (error) { alert('Error al crear proyecto: ' + error.message); setGuardando(false); return }

    // Primera sesión
    const { error: sesErr } = await supabase.from('sesiones').insert({
      proyecto_id: proyecto!.id,
      tatuador_id: tatuadorId,
      numero: 1,
      inicio: new Date(`${nuevo.fecha}T${nuevo.hora}:00`).toISOString(),
      puesto_id: puestoId || null,
      valor: nuevo.valor ? Number(nuevo.valor) : 0,
      abono: nuevo.abono ? Number(nuevo.abono) : 0,
      abonado: nuevo.abonado,
    })
    if (sesErr) { alert('Proyecto creado, pero falló la sesión: ' + sesErr.message) }

    setGuardando(false)
    setMostrarForm(false)
    setNuevo(NUEVO_VACIO)
    setClienteSel(null); setBusquedaCliente(''); setModoCliente('')
    cargar()
  }

  async function agregarSesion(p: ProyectoFull) {
    if (!sesionForm.fecha) { alert('Falta la fecha'); return }
    let puestoSel = sesionForm.puesto_id
    if (esTatuador && (miTipo === 'full' || miTipo === 'compartido')) {
      puestoSel = miPuestoPropio?.id ?? ''
    }
    if (esTatuador && !puestoSel) { alert('Elige un cupo disponible para la sesión'); return }
    const { puestoId, bloque } = parsePuesto(puestoSel)
    if (puestoId) {
      const ok = await asegurarReserva(p.tatuador_id, puestoId, sesionForm.fecha, sesionForm.hora, bloque)
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

  // Cancelar proyecto: también se cancelan sus sesiones no terminadas
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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 18 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <h1>Agendar Proyecto</h1>
          <button className={`chico ${tab === 'activos' ? '' : 'secundario'}`} onClick={() => setTab('activos')}>Activos</button>
          <button className={`chico ${tab === 'cerrados' ? '' : 'secundario'}`} onClick={() => setTab('cerrados')}>Cerrados</button>
        </div>
        <button onClick={() => setMostrarForm(!mostrarForm)}>
          {mostrarForm ? 'Cerrar' : '+ Agendar proyecto'}
        </button>
      </div>

      {mostrarForm && (
        <div className="card" style={{ marginBottom: 18 }}>
          <div className="section-title">Nuevo proyecto de tatuaje</div>

          {/* Cliente */}
          <div style={{ marginBottom: 12 }}>
            <label>Cliente {esTatuador ? '(solo tus clientes asignados)' : ''}</label>
            {clienteSel ? (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span className="pill ok">{clienteSel.nombre}{clienteSel.rut ? ` · ${formatRut(clienteSel.rut)}` : ''}</span>
                <button className="chico secundario" onClick={() => { setClienteSel(null); setModoCliente('') }}>✕ cambiar</button>
              </div>
            ) : (
              <>
                <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                  <button className={`chico ${modoCliente === 'nuevo' ? '' : 'secundario'}`}
                    onClick={() => { setModoCliente('nuevo'); setBusquedaCliente(''); setResultadosCliente([]) }}>
                    Cliente nuevo
                  </button>
                  <button className={`chico ${modoCliente === 'registrado' ? '' : 'secundario'}`}
                    onClick={() => { setModoCliente('registrado'); setNuevo(n => ({ ...n, nuevo_nombre: '', nuevo_telefono: '', nuevo_instagram: '', nuevo_email: '' })) }}>
                    Cliente registrado
                  </button>
                </div>

                {modoCliente === 'registrado' && (
                  <>
                    <input value={busquedaCliente} placeholder="Buscar por nombre o RUT…"
                      onChange={e => setBusquedaCliente(e.target.value)} autoFocus />
                    {resultadosCliente.length > 0 && (
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
                        {resultadosCliente.map(c => (
                          <button key={c.id} className="chico secundario" onClick={() => {
                            setClienteSel(c); setBusquedaCliente(''); setResultadosCliente([])
                          }}>
                            {c.nombre}{c.rut ? ` · ${formatRut(c.rut)}` : ''}
                          </button>
                        ))}
                      </div>
                    )}
                    {busquedaCliente.trim().length >= 2 && resultadosCliente.length === 0 && (
                      <p style={{ fontSize: 12, color: 'var(--text3)', marginTop: 6 }}>Sin resultados.</p>
                    )}
                  </>
                )}

                {modoCliente === 'nuevo' && (
                  <>
                    <div className="fila-form">
                      <div>
                        <label>Nombre *</label>
                        <input value={nuevo.nuevo_nombre} autoFocus onChange={e => setNuevo({ ...nuevo, nuevo_nombre: e.target.value })} />
                      </div>
                      <div>
                        <label>Teléfono</label>
                        <input value={nuevo.nuevo_telefono} onChange={e => setNuevo({ ...nuevo, nuevo_telefono: e.target.value })} />
                      </div>
                      <div>
                        <label>Instagram</label>
                        <input value={nuevo.nuevo_instagram} placeholder="@usuario" onChange={e => setNuevo({ ...nuevo, nuevo_instagram: e.target.value })} />
                      </div>
                      <div>
                        <label>Correo</label>
                        <input value={nuevo.nuevo_email} onChange={e => setNuevo({ ...nuevo, nuevo_email: e.target.value })} />
                      </div>
                    </div>
                    <p style={{ fontSize: 12, color: 'var(--text3)', marginTop: 8 }}>
                      Datos provisorios: se sobreescribirán con la información oficial del consentimiento informado el día de la sesión.
                    </p>
                  </>
                )}
              </>
            )}
          </div>

          {/* Tatuador / origen */}
          <div className="fila-form" style={{ marginBottom: 12 }}>
            {esTatuador ? (
              <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, margin: 0, cursor: 'pointer', color: 'var(--text)', fontSize: 13 }}>
                  <input type="checkbox" checked={nuevo.desde_okami} style={{ width: 'auto' }}
                    onChange={e => setNuevo({ ...nuevo, desde_okami: e.target.checked })} />
                  Este cliente llegó desde una cotización de Okami
                </label>
              </div>
            ) : (
              <div>
                <label>Tatuador (reciben cotizaciones del estudio)</label>
                <select value={nuevo.tatuador_id} onChange={e => setNuevo({ ...nuevo, tatuador_id: e.target.value })}>
                  <option value="">—</option>
                  {tatuadores.filter(t => t.en_sistema && t.participa_cotizaciones).map(t => (
                    <option key={t.id} value={t.id}>{t.nombre_artistico || t.nombre}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Descripción del proyecto */}
          <div style={{ marginBottom: 12 }}>
            <label>Descripción del proyecto *</label>
            <textarea rows={2} value={nuevo.descripcion} onChange={e => setNuevo({ ...nuevo, descripcion: e.target.value })} />
          </div>
          <div className="fila-form" style={{ marginBottom: 12 }}>
            <div>
              <label>Estilo</label>
              <select value={nuevo.estilo_id} onChange={e => setNuevo({ ...nuevo, estilo_id: e.target.value })}>
                <option value="">—</option>
                {estilos.map(e => <option key={e.id} value={e.id}>{e.nombre}</option>)}
              </select>
            </div>
            <div>
              <label>Lugar del cuerpo</label>
              <input value={nuevo.zona} onChange={e => setNuevo({ ...nuevo, zona: e.target.value })} />
            </div>
            <div>
              <label>Tamaño</label>
              <input value={nuevo.tamano} placeholder="ej: 10x15 cm" onChange={e => setNuevo({ ...nuevo, tamano: e.target.value })} />
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, margin: 0, cursor: 'pointer', color: 'var(--text)', fontSize: 13 }}>
                <input type="checkbox" checked={nuevo.a_color} style={{ width: 'auto' }}
                  onChange={e => setNuevo({ ...nuevo, a_color: e.target.checked })} />
                A color
              </label>
            </div>
          </div>
          <div style={{ marginBottom: 14 }}>
            <label>Otros comentarios</label>
            <input value={nuevo.comentarios} onChange={e => setNuevo({ ...nuevo, comentarios: e.target.value })} />
          </div>

          {/* Primera sesión */}
          <div className="section-title">Primera sesión</div>
          <div className="fila-form" style={{ marginBottom: 14 }}>
            <div>
              <label>Fecha *</label>
              <input type="date" value={nuevo.fecha}
                onChange={e => { setNuevo({ ...nuevo, fecha: e.target.value, puesto_id: esTatuador && miTipo !== 'full' && miTipo !== 'compartido' ? '' : nuevo.puesto_id }); cargarReservasFecha(e.target.value) }} />
            </div>
            <div>
              <label>Hora</label>
              <input type="time" value={nuevo.hora} onChange={e => setNuevo({ ...nuevo, hora: e.target.value })} />
            </div>
            <div>
              <label>Puesto</label>
              {renderSelectorPuesto(nuevo.fecha, nuevo.hora, nuevo.puesto_id, v => setNuevo({ ...nuevo, puesto_id: v }))}
            </div>
            <div>
              <label>Valor sesión (CLP)</label>
              <MoneyInput value={nuevo.valor} placeholder="$150.000"
                onChange={v => setNuevo({ ...nuevo, valor: v, abono: sugerirAbono(v) })} />
            </div>
            <div>
              <label>Abono (sugerido 50%)</label>
              <MoneyInput value={nuevo.abono} onChange={v => setNuevo({ ...nuevo, abono: v })} />
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, margin: 0, cursor: 'pointer', color: 'var(--text)', fontSize: 13 }}>
                <input type="checkbox" checked={nuevo.abonado} style={{ width: 'auto' }}
                  onChange={e => setNuevo({ ...nuevo, abonado: e.target.checked })} />
                Abono ya pagado
              </label>
            </div>
          </div>

          <button onClick={crearProyecto} disabled={guardando}>
            {guardando ? 'Guardando…' : 'Crear proyecto'}
          </button>
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
                    <p style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 4 }}>{p.descripcion}</p>
                    <p style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 12 }}>
                      {[p.zona, p.tamano, p.comentarios].filter(Boolean).join(' · ')}
                    </p>

                    {/* Sesiones */}
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

                    <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', fontSize: 13 }}>
                      <strong>Total abonado {formatCLP(totalAbonado)} · Total proyecto {formatCLP(totalProyecto)}</strong>
                    </div>

                    {/* Agregar sesión */}
                    {agregandoSesion === p.id ? (
                      <div className="fila-form" style={{ marginTop: 12, alignItems: 'flex-end' }}>
                        <div><label>Fecha</label>
                          <input type="date" value={sesionForm.fecha}
                            onChange={e => { setSesionForm({ ...sesionForm, fecha: e.target.value }); cargarReservasFecha(e.target.value) }} /></div>
                        <div><label>Hora</label>
                          <input type="time" value={sesionForm.hora} onChange={e => setSesionForm({ ...sesionForm, hora: e.target.value })} /></div>
                        <div><label>Puesto</label>
                          {renderSelectorPuesto(sesionForm.fecha, sesionForm.hora, sesionForm.puesto_id, v => setSesionForm({ ...sesionForm, puesto_id: v }))}</div>
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
                      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                        <button className="chico secundario" onClick={() => {
                          setAgregandoSesion(p.id)
                          setSesionForm({ fecha: '', hora: '12:00', puesto_id: '', valor: '', abono: '', abonado: false })
                        }}>+ Agregar sesión</button>
                        {p.estado === 'activo' && (
                          <>
                            <button className="chico secundario" onClick={() => actualizarProyecto(p.id, { estado: 'completado' })}>
                              Marcar proyecto completado
                            </button>
                            <button className="chico secundario" onClick={() => cancelarProyecto(p)}>
                              Cancelar proyecto
                            </button>
                          </>
                        )}
                        {p.estado !== 'activo' && (
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
