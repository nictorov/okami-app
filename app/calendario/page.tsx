'use client'
// Calendario: el centro de trabajo diario.
//  * Hoy preseleccionado al entrar.
//  * En cada día, junto a los puestos disponibles: "Agendar tatuaje" →
//    elegir entre "Nuevo tatuaje" (formulario completo) o "Sesión para
//    proyecto en curso", con fecha y puesto precargados.
//  * Bajo la disponibilidad, las sesiones del día seleccionado con toda
//    su gestión (consentimiento, imprimir/firmar, cierre).
// Reglas por tipo: full (su puesto, sin AM/PM), compartido (compañero
// "Ocupado", sin AM/PM), rotativo/guest (cupos Día 1..n, AM/PM en findes).
// Cancelación de reserva: mismo día en semana; findes con 1 día. Admin y
// recepción ven todos los calendarios y agendan a cualquiera.
import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import {
  Sesion, Proyecto, Cliente, Tatuador, Puesto, PuestoTitular,
} from '@/lib/types'
import { useSesion } from '@/lib/sesion'
import { aplicarReglas24h } from '@/lib/sesiones'
import {
  Reserva, Bloque, BLOQUE_LABEL, bloquesDe, esFinDeSemana,
  puedeCancelar, crearReserva, cancelarReserva, hoyISO, formatHorario,
} from '@/lib/reservas'
import FormTatuaje, { PrefillTatuaje } from '@/components/FormTatuaje'
import SesionCard, { SesionFull } from '@/components/SesionCard'
import { MoneyInput } from '@/components/money'
import {
  asegurarReserva, sugerirAbono, validarHorarioSesion, CamposHorario,
} from '@/components/agendar'

interface Calendario {
  id: string
  label: string
  tipo: 'full' | 'compartido' | 'rotativo'
  puestoIds: string[]
}

const DIAS_SEMANA = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']

function claveDia(fecha: Date): string {
  return `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}-${String(fecha.getDate()).padStart(2, '0')}`
}

// Una fecha ya pasada (anterior a hoy). El día de hoy NO es pasado:
// dentro de hoy se puede agendar a cualquier hora, aunque ya haya ocurrido.
function esPasado(fechaISO: string): boolean {
  return fechaISO < hoyISO()
}

// ── Sesión para proyecto en curso (con fecha/puesto precargados) ──
function SesionEnProyecto({ prefill, tatuadorId, puestos, onDone, onCancel }: {
  prefill: PrefillTatuaje
  tatuadorId: string
  puestos: Puesto[]
  onDone: () => void
  onCancel: () => void
}) {
  const { sesion } = useSesion()
  const rol = sesion?.rol ?? 'admin'
  const [proyectos, setProyectos] = useState<(Proyecto & { cliente: Cliente | null; sesiones: Sesion[] })[]>([])
  const [cargando, setCargando] = useState(true)
  const [proyectoSel, setProyectoSel] = useState('')
  const [hora, setHora] = useState('12:00')
  const [horario, setHorario] = useState({ todoDia: true, horaIni: '09:00', horaFin: '22:00' })
  const [valor, setValor] = useState('')
  const [abono, setAbono] = useState('')
  const [abonado, setAbonado] = useState(false)
  const [guardando, setGuardando] = useState(false)

  const tipoPuesto = puestos.find(p => p.id === prefill.puestoId)?.tipo ?? null
  const conHorario = tipoPuesto === 'full' || tipoPuesto === 'compartido'

  useEffect(() => {
    supabase.from('proyectos')
      .select('*, cliente:clientes(*), sesiones(*)')
      .eq('tatuador_id', tatuadorId).eq('estado', 'activo')
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        setProyectos((data as (Proyecto & { cliente: Cliente | null; sesiones: Sesion[] })[]) ?? [])
        setCargando(false)
      })
  }, [tatuadorId])

  async function crear() {
    const p = proyectos.find(x => x.id === proyectoSel)
    if (!p) { alert('Elige el proyecto'); return }
    setGuardando(true)

    // Full/comp: todo el día u hora inicio–fin, con chequeo de topes
    let horaSesion = hora
    let horaFinSesion: string | null = null
    if (conHorario && prefill.puestoId) {
      const h = await validarHorarioSesion({
        ...horario, puestoId: prefill.puestoId,
        fecha: prefill.fecha, tatuadorId,
      })
      if (!h) { setGuardando(false); return }
      horaSesion = h.horaInicioSesion
      horaFinSesion = h.horaFin
    }

    if (prefill.puestoId) {
      const ok = await asegurarReserva({
        puestos, puestoId: prefill.puestoId, bloqueForzado: prefill.bloque,
        fecha: prefill.fecha, hora: horaSesion,
        horaInicio: conHorario && !horario.todoDia ? horario.horaIni : undefined,
        horaFin: conHorario && !horario.todoDia ? horario.horaFin : undefined,
        tatuadorId, rol,
      })
      if (!ok) { setGuardando(false); return }
    }
    const filaSesion: Record<string, unknown> = {
      proyecto_id: p.id,
      tatuador_id: tatuadorId,
      numero: (p.sesiones?.length ?? 0) + 1,
      inicio: new Date(`${prefill.fecha}T${horaSesion}:00`).toISOString(),
      puesto_id: prefill.puestoId ?? null,
      valor: valor ? Number(valor) : 0,
      abono: abono ? Number(abono) : 0,
      abonado,
      abonado_en: abonado ? new Date().toISOString() : null,
    }
    if (horaFinSesion) filaSesion.hora_fin = horaFinSesion
    const { error } = await supabase.from('sesiones').insert(filaSesion)
    setGuardando(false)
    if (error) { alert('Error: ' + error.message); return }
    onDone()
  }

  if (cargando) return <div className="spinner" />

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div className="section-title" style={{ marginBottom: 0 }}>Sesión para proyecto en curso</div>
        <button className="chico secundario" onClick={onCancel}>✕ Cerrar</button>
      </div>
      {proyectos.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--text3)' }}>
          No hay proyectos activos para este tatuador. Usa &quot;Nuevo tatuaje&quot;.
        </p>
      ) : (
        <>
          <div style={{ marginBottom: 12 }}>
            <label>Proyecto *</label>
            <select value={proyectoSel} onChange={e => setProyectoSel(e.target.value)}>
              <option value="">— elegir proyecto —</option>
              {proyectos.map(p => (
                <option key={p.id} value={p.id}>
                  {p.folio} · {p.cliente?.nombre ?? '—'} · {(p.descripcion ?? '').slice(0, 40)} ({p.sesiones?.length ?? 0} sesión{(p.sesiones?.length ?? 0) !== 1 ? 'es' : ''})
                </option>
              ))}
            </select>
          </div>
          <div className="fila-form" style={{ marginBottom: 14 }}>
            {conHorario ? (
              <CamposHorario {...horario} onChange={setHorario} />
            ) : (
              <div style={{ maxWidth: 120 }}>
                <label>Hora</label>
                <input type="time" value={hora} onChange={e => setHora(e.target.value)} />
              </div>
            )}
            <div>
              <label>Valor sesión (CLP)</label>
              <MoneyInput value={valor} placeholder="$150.000"
                onChange={v => { setValor(v); setAbono(sugerirAbono(v)) }} />
            </div>
            <div>
              <label>Abono (sugerido 50%)</label>
              <MoneyInput value={abono} onChange={setAbono} />
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end', minWidth: 130 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, margin: 0, cursor: 'pointer', color: 'var(--text)', fontSize: 13 }}>
                <input type="checkbox" checked={abonado} style={{ width: 'auto' }}
                  onChange={e => setAbonado(e.target.checked)} />
                Abono ya pagado
              </label>
            </div>
          </div>
          <button onClick={crear} disabled={guardando || !proyectoSel}>
            {guardando ? 'Guardando…' : 'Agregar sesión'}
          </button>
        </>
      )}
    </div>
  )
}

// ════════════════ Página ════════════════

export default function CalendarioPage() {
  const { sesion } = useSesion()
  const esTatuador = sesion?.rol === 'tatuador'
  const esAdminHost = sesion?.rol === 'admin' || sesion?.rol === 'host'
  const esAdmin = sesion?.rol === 'admin'   // el admin sí puede editar fechas pasadas
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
  // Hoy preseleccionado al entrar
  const [diaSel, setDiaSel] = useState<string | null>(hoyISO())
  // Admin/host: grupo + tatuador para reservar/habilitar
  const [grupoReserva, setGrupoReserva] = useState<'' | 'full_compartido' | 'rotativo' | 'guest' | 'archivado'>('')
  const [tatParaReservar, setTatParaReservar] = useState('')
  // Flujo agendar desde el calendario
  const [agendando, setAgendando] = useState<{
    puestoId: string; bloque: Bloque; tatuadorId: string | null
  } | null>(null)
  const [paso, setPaso] = useState<'elegir' | 'nuevo' | 'proyecto'>('elegir')
  // "Solo reservar" en full/comp: elegir todo el día u horario
  const [reservando, setReservando] = useState<{ puestoId: string; bloque: Bloque } | null>(null)
  const [horarioRes, setHorarioRes] = useState({ todoDia: true, horaIni: '09:00', horaFin: '22:00' })

  const cargar = useCallback(async () => {
    setLoading(true)
    const desde = new Date(anio, mes, 1)
    const hasta = new Date(anio, mes + 1, 1)
    const [s, r, t, p, ti] = await Promise.all([
      supabase.from('sesiones')
        .select('*, proyecto:proyectos(*, cliente:clientes(*))')
        .gte('inicio', desde.toISOString()).lt('inicio', hasta.toISOString())
        .order('inicio', { ascending: true }),
      supabase.from('reservas').select('*')
        .gte('fecha', claveDia(desde)).lt('fecha', claveDia(hasta))
        .eq('estado', 'activa'),
      // Todos los tatuadores: las reservas/sesiones de archivados
      // deben seguir mostrando sus nombres
      supabase.from('tatuadores').select('*'),
      supabase.from('puestos').select('*').eq('activo', true).eq('gestionado', true).order('orden'),
      supabase.from('puesto_titulares').select('*'),
    ])
    setSesiones(await aplicarReglas24h((s.data as SesionFull[]) ?? []))
    setReservas((r.data as Reserva[]) ?? [])
    setTatuadores((t.data as Tatuador[]) ?? [])
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

  // El calendario que corresponde según el rol
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
  // Sesiones canceladas fuera; cada calendario muestra solo lo suyo
  const sesActivas = sesiones.filter(s => s.estado !== 'cancelada')
  const sesVisibles = esTatuador && miId
    ? sesActivas.filter(s => s.tatuador_id === miId)
    : sesActivas.filter(s => cal && s.puesto_id && cal.puestoIds.includes(s.puesto_id))
  const sesPorDia: Record<string, SesionFull[]> = {}
  for (const s of sesVisibles) {
    const k = claveDia(new Date(s.inicio))
    sesPorDia[k] = sesPorDia[k] ?? []
    sesPorDia[k].push(s)
  }

  // Solo el calendario rotativo divide los findes en AM/PM
  function bloquesDelCal(fechaISO: string): Bloque[] {
    return cal?.tipo === 'rotativo' ? bloquesDe(fechaISO) : ['dia']
  }

  function etiquetaCupo(puestoId: string): string {
    if (!cal) return ''
    if (cal.tipo !== 'rotativo') return puestos.find(p => p.id === puestoId)?.nombre ?? ''
    const idx = cal.puestoIds.indexOf(puestoId)
    return `Día ${idx + 1}`
  }

  async function reservar(fecha: string, bloque: Bloque, puestoId: string,
    horas?: { horaIni: string; horaFin: string }) {
    if (esPasado(fecha) && !esAdmin) { alert('No se puede reservar en una fecha ya pasada.'); return }
    const tatuadorId = esTatuador ? miId : tatParaReservar
    if (!tatuadorId) { alert('Elige el tatuador para la reserva'); return }
    if (horas && horas.horaFin <= horas.horaIni) {
      alert('La hora de fin debe ser posterior a la hora de inicio.')
      return
    }
    const { error } = await crearReserva({
      fecha, bloque, puesto_id: puestoId, tatuador_id: tatuadorId,
      creada_por: rol as 'tatuador' | 'host' | 'admin',
      hora_inicio: horas?.horaIni,
      hora_fin: horas?.horaFin,
    })
    if (error) { alert(error); return }
    setReservando(null)
    cargar()
  }

  async function cancelar(r: Reserva) {
    if (esPasado(r.fecha) && !esAdmin) { alert('No se puede cancelar una reserva de una fecha ya pasada.'); return }
    if (esTatuador) {
      if (r.tatuador_id !== miId) return
      if (!puedeCancelar(r)) {
        alert('Las reservas de fin de semana se cancelan con al menos 1 día de anticipación.')
        return
      }
    }
    // Sesiones de ese tatuador ese día en ese puesto: se cancelan junto
    // con la reserva (avisando antes)
    const sesDelDia = sesiones.filter(s =>
      s.tatuador_id === r.tatuador_id &&
      s.puesto_id === r.puesto_id &&
      s.estado !== 'cancelada' &&
      claveDia(new Date(s.inicio)) === r.fecha)
    if (sesDelDia.length > 0) {
      const n = sesDelDia.length
      if (!confirm(`Esta reserva tiene ${n} sesión${n !== 1 ? 'es' : ''} agendada${n !== 1 ? 's' : ''} ese día. ` +
        `Si cancelas la reserva, también se cancelará${n !== 1 ? 'n' : ''} esa${n !== 1 ? 's' : ''} sesión${n !== 1 ? 'es' : ''}. ¿Continuar?`)) return
    } else if (!confirm('¿Cancelar esta reserva?')) {
      return
    }
    await cancelarReserva(r.id)
    for (const s of sesDelDia) {
      await supabase.from('sesiones')
        .update({ estado: 'cancelada', observacion: 'Cancelada al anular la reserva del día' })
        .eq('id', s.id)
    }
    cargar()
  }

  function cambiarMes(delta: number) {
    let m = mes + delta, a = anio
    if (m < 0) { m = 11; a-- }
    if (m > 11) { m = 0; a++ }
    setMes(m); setAnio(a); setDiaSel(null); setAgendando(null); setReservando(null)
  }

  function abrirAgendar(puestoId: string, bloque: Bloque, tatuadorSug: string | null) {
    if (diaSel && esPasado(diaSel) && !esAdmin) { alert('No se puede agendar en una fecha ya pasada.'); return }
    setAgendando({ puestoId, bloque, tatuadorId: tatuadorSug })
    setPaso('elegir')
  }

  function cerrarAgendar() {
    setAgendando(null)
    setPaso('elegir')
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
  // Fecha pasada = solo lectura, EXCEPTO para el admin (puede editarla)
  const diaPasado = diaSel ? (esPasado(diaSel) && !esAdmin) : false

  const prefillActual: PrefillTatuaje | null = agendando && diaSel ? {
    fecha: diaSel,
    puestoId: agendando.puestoId,
    bloque: agendando.bloque !== 'dia' ? agendando.bloque : undefined,
    tatuadorId: agendando.tatuadorId ?? undefined,
    etiquetaPuesto: etiquetaCupo(agendando.puestoId),
  } : null

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 18 }}>
        <h1>Calendario</h1>
        <button className="chico secundario" onClick={() => cambiarMes(-1)}>←</button>
        <strong style={{ minWidth: 150, textAlign: 'center' }}>{MESES[mes]} {anio}</strong>
        <button className="chico secundario" onClick={() => cambiarMes(1)}>→</button>
        {esAdminHost ? (
          <select value={cal?.id ?? ''} onChange={e => { setCalSel(e.target.value); setDiaSel(hoyKey); setAgendando(null) }}
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
          <div className="card" style={{ padding: 10, overflowX: 'auto', marginBottom: 14 }}>
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
                const capacidad = cal.puestoIds.length * (finde && cal.tipo === 'rotativo' ? 2 : 1)
                const ocupadas = resDia.length
                const lleno = ocupadas >= capacidad
                const tengoReserva = esTatuador && resDia.some(r => r.tatuador_id === miId)
                return (
                  <div key={i}
                    onClick={() => { setDiaSel(seleccionado ? null : k); setAgendando(null); setReservando(null) }}
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
                    {esTatuador && cal.tipo === 'rotativo' && tengoReserva && (
                      <div style={{ fontSize: 10, color: 'var(--success-text)' }}>● Reservado</div>
                    )}
                    {/* Full/comp: cada reserva con su horario (si tiene) */}
                    {esTatuador && cal.tipo !== 'rotativo' && resDia.map(r => (
                      <div key={r.id} style={{ fontSize: 10, whiteSpace: 'nowrap', overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        color: r.tatuador_id === miId ? 'var(--success-text)' : 'var(--warning-text)' }}>
                        ● {r.tatuador_id === miId ? 'Reservado' : 'Ocupado'}
                        {r.hora_inicio ? ` ${formatHorario(r.hora_inicio, r.hora_fin)}` : ''}
                      </div>
                    ))}
                    {!esTatuador && resDia.slice(0, 2).map(r => (
                      <div key={r.id} style={{ fontSize: 10, color: 'var(--text2)', whiteSpace: 'nowrap',
                        overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        ● {nombreTat(r.tatuador_id).split(' ')[0]}{r.bloque !== 'dia' ? ` (${r.bloque.toUpperCase()})` : ''}
                        {r.hora_inicio ? ` ${formatHorario(r.hora_inicio, r.hora_fin)}` : ''}
                      </div>
                    ))}
                    {!esTatuador && resDia.length > 2 && (
                      <div style={{ fontSize: 9, color: 'var(--text3)' }}>+{resDia.length - 2} reservas</div>
                    )}
                    {sesDia.slice(0, 2).map(s => (
                      <div key={s.id} style={{ fontSize: 10, color: 'var(--text2)', whiteSpace: 'nowrap',
                        overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        ○ {new Date(s.inicio).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}
                        {s.hora_fin ? `–${s.hora_fin.slice(0, 5)}` : ''}
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

          {/* ── Detalle del día ── */}
          {diaSel && (
            <div>
              <h2 style={{ marginBottom: 10 }}>
                {new Date(`${diaSel}T12:00:00`).toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long' })}
                {diaPasado && (
                  <span className="pill" style={{ marginLeft: 8, fontWeight: 400 }}>Fecha pasada · solo lectura</span>
                )}
                {!diaPasado && esFinDeSemana(diaSel) && cal.tipo === 'rotativo' && (
                  <span style={{ fontSize: 12, color: 'var(--text3)', fontWeight: 400, marginLeft: 8 }}>
                    Fin de semana: turnos AM y PM (reservar ambos = día completo, de mayor valor)
                  </span>
                )}
              </h2>

              {/* Disponibilidad y agendar */}
              <div className="card" style={{ marginBottom: 12 }}>
                <div className="section-title">Disponibilidad de {cal.label}</div>
                {esAdminHost && (
                  <div style={{ marginBottom: 10 }}>
                    <label>Reservar / habilitar para</label>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <select value={grupoReserva} style={{ width: 180 }}
                        onChange={e => {
                          setGrupoReserva(e.target.value as typeof grupoReserva)
                          setTatParaReservar('')
                        }}>
                        <option value="">— tipo de tatuador —</option>
                        <option value="full_compartido">Full / Compartido</option>
                        <option value="rotativo">Rotativo</option>
                        <option value="guest">Guest</option>
                        <option value="archivado">Archivado</option>
                      </select>
                      {grupoReserva && (
                        <select value={tatParaReservar} style={{ width: 220 }}
                          onChange={e => setTatParaReservar(e.target.value)}>
                          <option value="">— elegir tatuador —</option>
                          {tatuadores
                            .filter(t => !t.eliminado)
                            .filter(t => grupoReserva === 'archivado'
                              ? t.archivado
                              : !t.archivado && (grupoReserva === 'full_compartido'
                                ? ['full', 'compartido'].includes(t.tipo_puesto ?? 'rotativo')
                                : (t.tipo_puesto ?? 'rotativo') === grupoReserva))
                            .map(t => (
                              <option key={t.id} value={t.id}>
                                {t.nombre_artistico || t.nombre}
                                {grupoReserva === 'archivado' ? ` (${t.tipo_puesto ?? 'rotativo'})` : ''}
                              </option>
                            ))}
                        </select>
                      )}
                    </div>
                  </div>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {cal.puestoIds.map(pid => (
                    bloquesDelCal(diaSel).map(bloque => {
                      // Puede haber varias reservas por cupo (tramos de horario
                      // en full/comp); una sin horas bloquea el día completo
                      const resCupo = reservasDia.filter(r => r.puesto_id === pid && r.bloque === bloque)
                      const resDiaCompleto = resCupo.find(r => !r.hora_inicio) ?? null
                      const esFull = cal.tipo === 'full'
                      const esMiaDC = !!resDiaCompleto && esTatuador && resDiaCompleto.tatuador_id === miId
                      // Bloqueado solo si OTRO tiene el día completo; con
                      // reservas por horario se puede agendar igual (tramo libre)
                      const puedeAgendar = esTatuador
                        ? !(resDiaCompleto && resDiaCompleto.tatuador_id !== miId)
                        : true
                      const tatuadorSug = resDiaCompleto
                        ? resDiaCompleto.tatuador_id
                        : (cal.tipo !== 'rotativo'
                          ? (titulares.find(t => t.puesto_id === pid)?.tatuador_id ?? null)
                          : (esTatuador ? miId : (tatParaReservar || null)))
                      const chipReserva = (r: Reserva) => {
                        const horario = r.hora_inicio ? ` · ${formatHorario(r.hora_inicio, r.hora_fin)}` : ''
                        const esMiaR = esTatuador && r.tatuador_id === miId
                        return (
                          <span key={r.id} style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                            {esMiaR ? <span className="pill ok">Reservado por ti{horario}</span>
                              : esTatuador ? <span className="pill alerta">Ocupado{horario}</span>
                              : <span className="pill alerta">{nombreTat(r.tatuador_id)}{horario}</span>}
                            {(esMiaR || esAdminHost) && r.hora_inicio && !diaPasado && (
                              <button className="chico secundario" style={{ padding: '2px 7px' }}
                                title="Cancelar esta reserva" onClick={() => cancelar(r)}>✕</button>
                            )}
                          </span>
                        )
                      }
                      return (
                        <div key={`${pid}-${bloque}`}>
                          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', fontSize: 13 }}>
                            <strong style={{ minWidth: 70 }}>{etiquetaCupo(pid)}</strong>
                            {bloque !== 'dia' && <span className="pill">{BLOQUE_LABEL[bloque]}</span>}
                            {resCupo.length === 0 && <span className="pill">Libre</span>}
                            {resCupo.map(chipReserva)}
                            {diaPasado ? null : resDiaCompleto ? (
                              (esMiaDC || esAdminHost) && (
                                <>
                                  <button className="chico"
                                    onClick={() => abrirAgendar(pid, bloque, resDiaCompleto.tatuador_id)}>
                                    Agendar tatuaje
                                  </button>
                                  <button className="chico secundario" onClick={() => cancelar(resDiaCompleto)}>
                                    Cancelar reserva
                                  </button>
                                </>
                              )
                            ) : (
                              <>
                                {puedeAgendar && (
                                  <button className="chico"
                                    onClick={() => abrirAgendar(pid, bloque, esTatuador ? miId : tatuadorSug)}>
                                    Agendar tatuaje
                                  </button>
                                )}
                                {(esAdminHost || (esTatuador && !esFull)) && (
                                  <button className="chico secundario" onClick={() => {
                                    if (cal.tipo === 'rotativo') { reservar(diaSel, bloque, pid); return }
                                    setHorarioRes({ todoDia: resCupo.length === 0, horaIni: '09:00', horaFin: '22:00' })
                                    setReservando(x => x && x.puestoId === pid && x.bloque === bloque
                                      ? null : { puestoId: pid, bloque })
                                  }}>
                                    Solo reservar
                                  </button>
                                )}
                              </>
                            )}
                          </div>
                          {/* Mini-formulario de reserva con horario (full/comp) */}
                          {reservando && reservando.puestoId === pid && reservando.bloque === bloque && (
                            <div style={{
                              display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap',
                              margin: '8px 0 4px', padding: 10, borderRadius: 8,
                              border: '0.5px solid var(--border)', background: 'var(--bg2)',
                            }}>
                              <CamposHorario {...horarioRes} onChange={setHorarioRes} />
                              <button className="chico" onClick={() => reservar(diaSel, bloque, pid,
                                horarioRes.todoDia ? undefined : { horaIni: horarioRes.horaIni, horaFin: horarioRes.horaFin })}>
                                Confirmar reserva
                              </button>
                              <button className="chico secundario" onClick={() => setReservando(null)}>✕</button>
                            </div>
                          )}
                        </div>
                      )
                    })
                  ))}
                </div>
              </div>

              {/* Flujo agendar tatuaje */}
              {agendando && prefillActual && (
                <div style={{ marginBottom: 12 }}>
                  {paso === 'elegir' && (
                    <div className="card">
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                        <div className="section-title" style={{ marginBottom: 0 }}>
                          Agendar en {etiquetaCupo(agendando.puestoId)}
                          {agendando.bloque !== 'dia' ? ` · ${BLOQUE_LABEL[agendando.bloque]}` : ''}
                          {!esTatuador && agendando.tatuadorId ? ` · ${nombreTat(agendando.tatuadorId)}` : ''}
                        </div>
                        <button className="chico secundario" onClick={cerrarAgendar}>✕ Cerrar</button>
                      </div>
                      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                        <button onClick={() => setPaso('nuevo')}>Nuevo tatuaje</button>
                        <button className="secundario" onClick={() => {
                          if (!esTatuador && !agendando.tatuadorId) {
                            alert('Elige primero el tatuador en "Reservar / habilitar para" (arriba)')
                            return
                          }
                          setPaso('proyecto')
                        }}>
                          Sesión para proyecto en curso
                        </button>
                      </div>
                    </div>
                  )}
                  {paso === 'nuevo' && (
                    <FormTatuaje prefill={prefillActual}
                      onDone={() => { cerrarAgendar(); cargar() }}
                      onCancel={cerrarAgendar} />
                  )}
                  {paso === 'proyecto' && (esTatuador ? miId : agendando.tatuadorId) && (
                    <SesionEnProyecto
                      prefill={prefillActual}
                      tatuadorId={(esTatuador ? miId : agendando.tatuadorId)!}
                      puestos={puestos}
                      onDone={() => { cerrarAgendar(); cargar() }}
                      onCancel={cerrarAgendar} />
                  )}
                </div>
              )}

              {/* Sesiones del día (gestión completa) */}
              <div className="section-title">Sesiones del día</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {sesionesDia.map(s => (
                  <SesionCard key={s.id} s={s} tatuadores={tatuadores} onChanged={cargar} />
                ))}
                {sesionesDia.length === 0 && (
                  <div className="vacio" style={{ padding: 16 }}>Sin sesiones este día.</div>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
