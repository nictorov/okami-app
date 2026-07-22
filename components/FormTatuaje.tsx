'use client'
// Formulario "Agendar Tatuaje": crea un proyecto con su primera sesión.
// Reutilizado en Mis tatuajes / Registro Tatuajes y en el Calendario
// (con fecha/puesto/tatuador precargados). Los campos opcionales van en
// cajas "opcional" para que el llenado obligatorio sea evidente.
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import {
  Cliente, Estilo, Tatuador, Puesto, PuestoTitular,
  formatRut, normalizarRut,
} from '@/lib/types'
import { useSesion } from '@/lib/sesion'
import { Bloque, BLOQUE_LABEL } from '@/lib/reservas'
import { MoneyInput } from '@/components/money'
import {
  SelectorPuesto, parsePuestoSel, asegurarReserva, sugerirAbono,
  validarHorarioSesion, CamposHorario,
  HorarioRotativo, horarioRotativoInicial, validarHorarioRotativo, CamposHorarioRotativo,
} from '@/components/agendar'

export interface PrefillTatuaje {
  fecha: string
  puestoId?: string
  bloque?: Bloque
  tatuadorId?: string
  etiquetaPuesto?: string   // ej: "Día 2" o "Puesto 6"
}

export default function FormTatuaje({ prefill, onDone, onCancel }: {
  prefill?: PrefillTatuaje
  onDone: () => void
  onCancel?: () => void
}) {
  const { sesion } = useSesion()
  const esTatuador = sesion?.rol === 'tatuador'
  const miId = sesion?.tatuadorId ?? null
  const rol = sesion?.rol ?? 'admin'

  const [estilos, setEstilos] = useState<Estilo[]>([])
  const [tatuadores, setTatuadores] = useState<Tatuador[]>([])
  const [puestos, setPuestos] = useState<Puesto[]>([])
  const [titulares, setTitulares] = useState<PuestoTitular[]>([])
  const [guardando, setGuardando] = useState(false)

  // Cliente
  const [modoCliente, setModoCliente] = useState<'' | 'nuevo' | 'registrado'>('')
  const [clienteSel, setClienteSel] = useState<Cliente | null>(null)
  const [busquedaCliente, setBusquedaCliente] = useState('')
  const [resultadosCliente, setResultadosCliente] = useState<Cliente[]>([])
  const [cli, setCli] = useState({ nombre: '', telefono: '', instagram: '', email: '' })

  // Proyecto
  const [desc, setDesc] = useState('')
  const [desdeOkami, setDesdeOkami] = useState(false)
  const [tatuadorId, setTatuadorId] = useState(prefill?.tatuadorId ?? '')
  const [opc, setOpc] = useState({ estilo_id: '', zona: '', tamano: '', comentarios: '', a_color: false })

  // Primera sesión
  const [ses, setSes] = useState({
    fecha: prefill?.fecha ?? '',
    hora: '12:00',
    puesto: prefill?.puestoId
      ? (prefill.bloque ? `${prefill.puestoId}::${prefill.bloque}` : prefill.puestoId)
      : '',
    valor: '', abono: '', abonado: false,
  })
  // Horario (solo puestos full/compartido): todo el día u hora inicio–fin
  const [horario, setHorario] = useState({ todoDia: true, horaIni: '09:00', horaFin: '22:00' })

  const { puestoId: puestoSelId, bloque: bloqueSel } = parsePuestoSel(ses.puesto)
  const tipoPuestoSel = puestos.find(p => p.id === puestoSelId)?.tipo ?? null
  const conHorario = tipoPuestoSel === 'full' || tipoPuestoSel === 'compartido'
  const esRotativoSel = tipoPuestoSel === 'rotativo'

  // Horario rotativo: límites por turno (se reinicia al cambiar fecha/cupo)
  const [horarioRot, setHorarioRot] = useState<HorarioRotativo>(
    () => horarioRotativoInicial(prefill?.fecha ?? '', prefill?.bloque))
  useEffect(() => {
    setHorarioRot(horarioRotativoInicial(ses.fecha, bloqueSel))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ses.fecha, ses.puesto])

  useEffect(() => {
    Promise.all([
      supabase.from('estilos').select('*').eq('activo', true).order('orden'),
      supabase.from('tatuadores').select('*'),
      supabase.from('puestos').select('*').eq('activo', true).eq('gestionado', true).order('orden'),
      supabase.from('puesto_titulares').select('*'),
    ]).then(([e, t, p, ti]) => {
      setEstilos(e.data ?? [])
      setTatuadores((t.data as Tatuador[]) ?? [])
      setPuestos(p.data ?? [])
      setTitulares(ti.data ?? [])
    })
  }, [])

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

  async function crear() {
    const tatFinal = esTatuador ? miId : tatuadorId
    if (!tatFinal) { alert('Falta el tatuador'); return }
    if (!clienteSel) {
      if (modoCliente === 'registrado') { alert('Busca y selecciona el cliente registrado'); return }
      if (modoCliente === 'nuevo' && !cli.nombre.trim()) { alert('El nombre del cliente nuevo es obligatorio'); return }
      if (!modoCliente) { alert('Elige "Cliente nuevo" o "Cliente registrado" y asigna un cliente'); return }
    }
    if (!desc.trim()) { alert('La descripción del proyecto es obligatoria'); return }
    if (!opc.estilo_id) { alert('El estilo (tipo de tatuaje) es obligatorio'); return }
    if (!opc.zona.trim()) { alert('El lugar del cuerpo es obligatorio'); return }
    if (!ses.fecha) { alert('La fecha de la primera sesión es obligatoria'); return }
    if (esTatuador && !ses.puesto) { alert('Elige un puesto disponible para la sesión'); return }

    const { puestoId, bloque } = parsePuestoSel(ses.puesto)
    setGuardando(true)

    // Horario de la sesión: full/comp usan todo el día o inicio–fin (con
    // chequeo de topes); rotativo/guest, horario limitado por turno.
    let horaSesion = ses.hora
    let horaFinSesion: string | null = null
    let bloquesReserva: Bloque[] | undefined
    if (conHorario && puestoId) {
      const h = await validarHorarioSesion({
        ...horario, puestoId, fecha: ses.fecha, tatuadorId: tatFinal,
      })
      if (!h) { setGuardando(false); return }
      horaSesion = h.horaInicioSesion
      horaFinSesion = h.horaFin
    } else if (esRotativoSel && puestoId) {
      const h = validarHorarioRotativo({ fecha: ses.fecha, bloque, v: horarioRot })
      if (!h) { setGuardando(false); return }
      horaSesion = h.horaIni
      horaFinSesion = h.horaFin
      bloquesReserva = h.bloques
    }

    // Bloquear el puesto (reserva) antes de agendar
    if (puestoId) {
      const ok = await asegurarReserva({
        puestos, puestoId, bloqueForzado: bloque, bloques: bloquesReserva,
        fecha: ses.fecha, hora: horaSesion,
        horaInicio: conHorario && !horario.todoDia ? horario.horaIni : undefined,
        horaFin: conHorario && !horario.todoDia ? horario.horaFin : undefined,
        tatuadorId: tatFinal, rol,
      })
      if (!ok) { setGuardando(false); return }
    }

    const esDesdeOkami = esTatuador ? desdeOkami : true

    // Cliente: existente o provisorio nuevo. Propiedad: solo si lo agendó
    // el tatuador directo (sin Okami)
    let clienteId = clienteSel?.id ?? null
    if (!clienteId) {
      const { data: cl, error: clErr } = await supabase.from('clientes').insert({
        nombre: cli.nombre.trim(),
        telefono: cli.telefono.trim() || null,
        instagram: cli.instagram.trim() || null,
        email: cli.email.trim() || null,
        tatuador_id: esTatuador && !esDesdeOkami ? miId : null,
      }).select('id').single()
      if (clErr) { alert('Error al crear cliente: ' + clErr.message); setGuardando(false); return }
      clienteId = cl!.id
    }

    const { data: folio } = await supabase.rpc('next_folio_proyecto')
    const { data: proyecto, error } = await supabase.from('proyectos').insert({
      folio,
      cliente_id: clienteId,
      tatuador_id: tatFinal,
      creado_por: rol,
      desde_okami: esDesdeOkami,
      descripcion: desc.trim(),
      estilo_id: opc.estilo_id || null,
      a_color: opc.a_color,
      zona: opc.zona.trim() || null,
      tamano: opc.tamano.trim() || null,
      comentarios: opc.comentarios.trim() || null,
    }).select('id').single()
    if (error) { alert('Error al crear proyecto: ' + error.message); setGuardando(false); return }

    const filaSesion: Record<string, unknown> = {
      proyecto_id: proyecto!.id,
      tatuador_id: tatFinal,
      numero: 1,
      inicio: new Date(`${ses.fecha}T${horaSesion}:00`).toISOString(),
      puesto_id: puestoId || null,
      valor: ses.valor ? Number(ses.valor) : 0,
      abono: ses.abono ? Number(ses.abono) : 0,
      abonado: ses.abonado,
      abonado_en: ses.abonado ? new Date().toISOString() : null,
    }
    if (horaFinSesion) filaSesion.hora_fin = horaFinSesion
    const { error: sesErr } = await supabase.from('sesiones').insert(filaSesion)
    if (sesErr) alert('Proyecto creado, pero falló la sesión: ' + sesErr.message)
    setGuardando(false)
    onDone()
  }

  const etiquetaPrefill = prefill?.puestoId
    ? `${prefill.etiquetaPuesto ?? (puestos.find(p => p.id === prefill.puestoId)?.nombre ?? '')}${prefill.bloque && prefill.bloque !== 'dia' ? ` · ${BLOQUE_LABEL[prefill.bloque]}` : ''}`
    : null

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div className="section-title" style={{ marginBottom: 0 }}>Nuevo proyecto de tatuaje</div>
        {onCancel && <button className="chico secundario" onClick={onCancel}>✕ Cerrar</button>}
      </div>

      {prefill && (
        <div className="banner info" style={{ marginBottom: 14 }}>
          📅 {new Date(`${prefill.fecha}T12:00:00`).toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long' })}
          {etiquetaPrefill && <> · {etiquetaPrefill}</>}
        </div>
      )}

      {/* ── Cliente ── */}
      <label>Cliente {esTatuador ? '(solo tus clientes asignados)' : ''}</label>
      {clienteSel ? (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 14 }}>
          <span className="pill ok">{clienteSel.nombre}{clienteSel.rut ? ` · ${formatRut(clienteSel.rut)}` : ''}</span>
          <button className="chico secundario" onClick={() => { setClienteSel(null); setModoCliente('') }}>✕ cambiar</button>
        </div>
      ) : (
        <div style={{ marginBottom: 14 }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <button className={`chico ${modoCliente === 'nuevo' ? '' : 'secundario'}`}
              onClick={() => { setModoCliente('nuevo'); setBusquedaCliente(''); setResultadosCliente([]) }}>
              Cliente nuevo
            </button>
            <button className={`chico ${modoCliente === 'registrado' ? '' : 'secundario'}`}
              onClick={() => { setModoCliente('registrado'); setCli({ nombre: '', telefono: '', instagram: '', email: '' }) }}>
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
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                <div style={{ flex: '0 0 240px' }}>
                  <label>Nombre *</label>
                  <input value={cli.nombre} autoFocus onChange={e => setCli({ ...cli, nombre: e.target.value })} />
                </div>
                <div className="grupo-opcional" style={{ flex: 1, minWidth: 280 }}>
                  <div className="etiqueta">Opcional</div>
                  <div className="fila-form">
                    <div>
                      <label>Teléfono</label>
                      <input value={cli.telefono} onChange={e => setCli({ ...cli, telefono: e.target.value })} />
                    </div>
                    <div>
                      <label>Instagram</label>
                      <input value={cli.instagram} placeholder="@usuario" onChange={e => setCli({ ...cli, instagram: e.target.value })} />
                    </div>
                    <div>
                      <label>Correo</label>
                      <input value={cli.email} onChange={e => setCli({ ...cli, email: e.target.value })} />
                    </div>
                  </div>
                </div>
              </div>
              <p style={{ fontSize: 12, color: 'var(--text3)', marginTop: 8 }}>
                Datos provisorios: se sobreescribirán con la información oficial del consentimiento informado el día de la sesión.
              </p>
            </>
          )}
        </div>
      )}

      {/* ── Tatuador / origen ── */}
      {esTatuador ? (
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '0 0 14px', cursor: 'pointer', color: 'var(--text)', fontSize: 13 }}>
          <input type="checkbox" checked={desdeOkami} style={{ width: 'auto' }}
            onChange={e => setDesdeOkami(e.target.checked)} />
          Este cliente llegó desde una cotización de Okami
        </label>
      ) : (
        <div style={{ marginBottom: 14, maxWidth: 300 }}>
          <label>Tatuador *</label>
          <select value={tatuadorId} onChange={e => setTatuadorId(e.target.value)}>
            <option value="">—</option>
            {tatuadores
              .filter(t => t.activo && !t.archivado && !t.eliminado && t.en_sistema)
              .map(t => (
                <option key={t.id} value={t.id}>{t.nombre_artistico || t.nombre}</option>
              ))}
          </select>
        </div>
      )}

      {/* ── Proyecto ── */}
      <div style={{ marginBottom: 12 }}>
        <label>Descripción del proyecto *</label>
        <textarea rows={2} value={desc} onChange={e => setDesc(e.target.value)} />
      </div>
      <div className="fila-form" style={{ marginBottom: 12 }}>
        <div>
          <label>Estilo *</label>
          <select value={opc.estilo_id} onChange={e => setOpc({ ...opc, estilo_id: e.target.value })}>
            <option value="">—</option>
            {estilos.map(e => <option key={e.id} value={e.id}>{e.nombre}</option>)}
          </select>
        </div>
        <div>
          <label>Lugar del cuerpo *</label>
          <input value={opc.zona} onChange={e => setOpc({ ...opc, zona: e.target.value })} />
        </div>
      </div>
      <div className="grupo-opcional" style={{ marginBottom: 16 }}>
        <div className="etiqueta">Opcional</div>
        <div className="fila-form" style={{ marginBottom: 10 }}>
          <div>
            <label>Tamaño</label>
            <input value={opc.tamano} placeholder="ej: 10x15 cm" onChange={e => setOpc({ ...opc, tamano: e.target.value })} />
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', minWidth: 90 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, margin: 0, cursor: 'pointer', color: 'var(--text)', fontSize: 13 }}>
              <input type="checkbox" checked={opc.a_color} style={{ width: 'auto' }}
                onChange={e => setOpc({ ...opc, a_color: e.target.checked })} />
              A color
            </label>
          </div>
        </div>
        <div>
          <label>Condiciones médicas y comentarios</label>
          <input value={opc.comentarios} onChange={e => setOpc({ ...opc, comentarios: e.target.value })} />
        </div>
      </div>

      {/* ── Primera sesión ── */}
      <div className="section-title">Primera sesión</div>
      <div className="fila-form" style={{ marginBottom: 16 }}>
        {!prefill && (
          <div>
            <label>Fecha *</label>
            <input type="date" value={ses.fecha} onChange={e => setSes({ ...ses, fecha: e.target.value, puesto: '' })} />
          </div>
        )}
        {conHorario ? (
          <CamposHorario {...horario} onChange={setHorario} />
        ) : esRotativoSel ? (
          <CamposHorarioRotativo
            fecha={ses.fecha} bloque={bloqueSel ?? prefill?.bloque}
            puestoId={puestoSelId} tatuadorId={esTatuador ? miId : (tatuadorId || null)}
            value={horarioRot} onChange={setHorarioRot} />
        ) : (
          <div style={{ maxWidth: 120 }}>
            <label>Hora</label>
            <input type="time" value={ses.hora} onChange={e => setSes({ ...ses, hora: e.target.value })} />
          </div>
        )}
        {!prefill?.puestoId && (
          <div>
            <label>Puesto</label>
            <SelectorPuesto fecha={ses.fecha} value={ses.puesto}
              onChange={v => setSes(s => ({ ...s, puesto: v }))}
              puestos={puestos} titulares={titulares} tatuadores={tatuadores} />
          </div>
        )}
        <div>
          <label>Valor sesión (CLP)</label>
          <MoneyInput value={ses.valor} placeholder="$150.000"
            onChange={v => setSes({ ...ses, valor: v, abono: sugerirAbono(v) })} />
        </div>
        <div>
          <label>Abono (sugerido 50%)</label>
          <MoneyInput value={ses.abono} onChange={v => setSes({ ...ses, abono: v })} />
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end', minWidth: 130 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, margin: 0, cursor: 'pointer', color: 'var(--text)', fontSize: 13 }}>
            <input type="checkbox" checked={ses.abonado} style={{ width: 'auto' }}
              onChange={e => setSes({ ...ses, abonado: e.target.checked })} />
            Abono ya pagado
          </label>
        </div>
      </div>

      <button onClick={crear} disabled={guardando}>
        {guardando ? 'Guardando…' : 'Crear proyecto'}
      </button>
    </div>
  )
}
