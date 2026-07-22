'use client'
// Lógica compartida para agendar sesiones: selector de puesto según rol
// y creación de la reserva que bloquea el puesto.
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Puesto, PuestoTitular, Tatuador } from '@/lib/types'
import {
  Reserva, Bloque, bloqueDesdeHora, crearReserva,
  minutosDe, seSolapan, horaCorta, esFinDeSemana, TURNO_HORAS,
} from '@/lib/reservas'
import { useSesion } from '@/lib/sesion'

// Un valor de puesto puede venir como "puestoId::bloque" (cupo rotativo
// ya reservado) o como puesto simple.
export function parsePuestoSel(v: string): { puestoId: string; bloque?: Bloque } {
  if (v.includes('::')) {
    const [p, b] = v.split('::')
    return { puestoId: p, bloque: b as Bloque }
  }
  return { puestoId: v }
}

export function sugerirAbono(valor: string): string {
  const v = Number(valor)
  return v > 0 ? String(Math.round(v / 2)) : ''
}

// Crea/confirma la reserva que bloquea el puesto de una sesión.
// Full: puesto propio, no requiere reserva. Devuelve false si hay tope
// (solo admin/host pueden confirmar y pasar por encima).
// horaInicio/horaFin (full/comp): tramo del día; sin ellas = día completo.
export async function asegurarReserva(args: {
  puestos: Puesto[]
  puestoId: string
  bloqueForzado?: Bloque
  bloques?: Bloque[]        // varios bloques (día completo AM+PM de finde)
  fecha: string
  hora: string
  horaInicio?: string
  horaFin?: string
  tatuadorId: string
  rol: 'tatuador' | 'host' | 'admin'
}): Promise<boolean> {
  const p = args.puestos.find(x => x.id === args.puestoId)
  if (!p || p.tipo === 'full') return true
  const lista = args.bloques ?? [
    args.bloqueForzado
      ?? (p.tipo === 'rotativo' ? bloqueDesdeHora(args.fecha, args.hora) : 'dia'),
  ]
  for (const bloque of lista) {
    const { error } = await crearReserva({
      fecha: args.fecha,
      bloque,
      puesto_id: args.puestoId,
      tatuador_id: args.tatuadorId,
      creada_por: args.rol,
      hora_inicio: args.horaInicio,
      hora_fin: args.horaFin,
    })
    if (!error) continue
    const msj = lista.length > 1 ? `${error} (turno ${bloque.toUpperCase()})` : error
    if (args.rol !== 'tatuador') {
      if (!confirm(`${msj} ¿Crear la sesión de todos modos?`)) return false
      continue
    }
    alert(msj)
    return false
  }
  return true
}

// Tope contra sesiones ya agendadas en ese puesto/fecha (además de las
// reservas): clave para puestos full, que no usan reservas. Una sesión
// sin hora_fin de un puesto full/comp se considera de día completo.
// Devuelve el detalle del choque con sesiones de otros ('deOtro') y con
// sesiones del mismo tatuador ('propio'), o null si no hay.
export async function topeSesiones(args: {
  puestoId: string
  fecha: string
  tatuadorId: string
  iniMin: number   // rango pedido, en minutos (todo el día = 0–1440)
  finMin: number
}): Promise<{ deOtro: string | null; propio: string | null }> {
  const desde = new Date(`${args.fecha}T00:00:00`).toISOString()
  const hasta = new Date(`${args.fecha}T23:59:59`).toISOString()
  const { data } = await supabase.from('sesiones')
    .select('id, tatuador_id, inicio, hora_fin, estado')
    .eq('puesto_id', args.puestoId)
    .gte('inicio', desde).lte('inicio', hasta)
    .neq('estado', 'cancelada')
  const detalle = (s: { inicio: string; hora_fin: string | null }): string => {
    if (!s.hora_fin) return 'una sesión de día completo'
    const d = new Date(s.inicio)
    const hIni = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    return `una sesión de ${hIni} a ${horaCorta(s.hora_fin)}`
  }
  let deOtro: string | null = null
  let propio: string | null = null
  for (const s of (data ?? []) as { tatuador_id: string; inicio: string; hora_fin: string | null }[]) {
    const d = new Date(s.inicio)
    const [a, b] = s.hora_fin
      ? [d.getHours() * 60 + d.getMinutes(), minutosDe(s.hora_fin)]
      : [0, 1440]
    if (!seSolapan(args.iniMin, args.finMin, a, b)) continue
    if (s.tatuador_id === args.tatuadorId) propio = propio ?? detalle(s)
    else deOtro = deOtro ?? detalle(s)
  }
  return { deOtro, propio }
}

// Validación + chequeo de topes del horario elegido para una sesión en
// un puesto full/compartido. Devuelve el horario listo para guardar,
// o null si no se puede agendar (ya alertó al usuario).
export async function validarHorarioSesion(args: {
  todoDia: boolean
  horaIni: string
  horaFin: string
  puestoId: string
  fecha: string
  tatuadorId: string
}): Promise<{ horaInicioSesion: string; horaFin: string | null } | null> {
  if (!args.todoDia) {
    if (!args.horaIni || !args.horaFin) {
      alert('Indica la hora de inicio y la hora de fin (o marca "Todo el día").')
      return null
    }
    if (args.horaFin <= args.horaIni) {
      alert('La hora de fin debe ser posterior a la hora de inicio.')
      return null
    }
  }
  const iniMin = args.todoDia ? 0 : minutosDe(args.horaIni)
  const finMin = args.todoDia ? 1440 : minutosDe(args.horaFin)
  const tope = await topeSesiones({
    puestoId: args.puestoId, fecha: args.fecha,
    tatuadorId: args.tatuadorId, iniMin, finMin,
  })
  if (tope.deOtro) {
    alert(`Tope de horario: ya hay ${tope.deOtro} agendada en ese puesto.`)
    return null
  }
  if (tope.propio && !confirm(`Ya tienes ${tope.propio} ese día en ese puesto. ¿Agendar de todos modos?`)) {
    return null
  }
  return {
    horaInicioSesion: args.todoDia ? '09:00' : args.horaIni,
    horaFin: args.todoDia ? null : args.horaFin,
  }
}

// ── Horario para sesiones en puestos ROTATIVOS (incluye guests) ──
// L–V: checkbox "Día completo" (la reserva siempre es del día completo;
//      al desmarcar solo se acota el horario de la sesión, 9:00–22:00).
// Finde: "Solo turno AM/PM" (horario dentro del turno) o "Día completo
//        AM|PM" (reserva ambos turnos; solo si el otro turno está libre).
export interface HorarioRotativo {
  diaCompleto: boolean    // L–V: checkbox marcado
  ambosTurnos: boolean    // finde: "Día completo AM|PM"
  horaIni: string
  horaFin: string
}

export function horarioRotativoInicial(fecha: string, bloque?: Bloque): HorarioRotativo {
  if (fecha && esFinDeSemana(fecha)) {
    const t = TURNO_HORAS[bloque === 'pm' ? 'pm' : 'am']
    return { diaCompleto: false, ambosTurnos: false, horaIni: t.ini, horaFin: t.fin }
  }
  return { diaCompleto: true, ambosTurnos: false, horaIni: TURNO_HORAS.dia.ini, horaFin: TURNO_HORAS.dia.fin }
}

// Valida el horario elegido contra los límites del turno. Devuelve el
// horario de la sesión y los bloques a reservar, o null si no pasa
// (ya alertó al usuario).
export function validarHorarioRotativo(args: {
  fecha: string
  bloque?: Bloque
  v: HorarioRotativo
}): { horaIni: string; horaFin: string; bloques: Bloque[] } | null {
  const finde = esFinDeSemana(args.fecha)
  if (!finde && args.v.diaCompleto) {
    return { horaIni: TURNO_HORAS.dia.ini, horaFin: TURNO_HORAS.dia.fin, bloques: ['dia'] }
  }
  const turno: Bloque = finde
    ? (args.v.ambosTurnos ? 'dia' : (args.bloque === 'pm' ? 'pm' : 'am'))
    : 'dia'
  const rango = TURNO_HORAS[turno]
  const etiqueta = finde && !args.v.ambosTurnos ? `del turno ${turno.toUpperCase()} ` : ''
  if (!args.v.horaIni || !args.v.horaFin) {
    alert('Indica la hora de inicio y la hora de fin.')
    return null
  }
  if (args.v.horaFin <= args.v.horaIni) {
    alert('La hora de fin debe ser posterior a la hora de inicio.')
    return null
  }
  if (args.v.horaIni < rango.ini || args.v.horaFin > rango.fin) {
    alert(`El horario ${etiqueta}debe estar entre ${rango.ini} y ${rango.fin}.`)
    return null
  }
  return {
    horaIni: args.v.horaIni,
    horaFin: args.v.horaFin,
    bloques: finde ? (args.v.ambosTurnos ? ['am', 'pm'] : [args.bloque === 'pm' ? 'pm' : 'am']) : ['dia'],
  }
}

// UI del horario rotativo. Consulta si el OTRO turno del finde está
// libre para habilitar "Día completo AM|PM".
export function CamposHorarioRotativo({ fecha, bloque, puestoId, tatuadorId, value, onChange }: {
  fecha: string
  bloque?: Bloque
  puestoId: string
  tatuadorId: string | null
  value: HorarioRotativo
  onChange: (v: HorarioRotativo) => void
}) {
  const finde = !!fecha && esFinDeSemana(fecha)
  const turno: Bloque = bloque === 'pm' ? 'pm' : 'am'
  const otro: Bloque = turno === 'am' ? 'pm' : 'am'
  // null = consultando
  const [otroLibre, setOtroLibre] = useState<boolean | null>(null)

  useEffect(() => {
    if (!finde || !puestoId || !fecha) { setOtroLibre(null); return }
    let cancel = false
    supabase.from('reservas').select('tatuador_id')
      .eq('puesto_id', puestoId).eq('fecha', fecha)
      .eq('bloque', otro).eq('estado', 'activa')
      .then(({ data }) => {
        if (cancel) return
        const filas = data ?? []
        setOtroLibre(filas.length === 0 || filas.every(r => r.tatuador_id === tatuadorId))
      })
    return () => { cancel = true }
  }, [finde, puestoId, fecha, otro, tatuadorId])

  const rango = finde
    ? (value.ambosTurnos ? TURNO_HORAS.dia : TURNO_HORAS[turno])
    : TURNO_HORAS.dia

  const camposHora = (
    <>
      <div style={{ maxWidth: 120 }}>
        <label>Hora inicio *</label>
        <input type="time" value={value.horaIni} min={rango.ini} max={rango.fin}
          onChange={e => onChange({ ...value, horaIni: e.target.value })} />
      </div>
      <div style={{ maxWidth: 120 }}>
        <label>Hora fin *</label>
        <input type="time" value={value.horaFin} min={rango.ini} max={rango.fin}
          onChange={e => onChange({ ...value, horaFin: e.target.value })} />
      </div>
    </>
  )

  if (!finde) {
    return (
      <>
        <div style={{ display: 'flex', alignItems: 'center', minWidth: 120 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, margin: 0, cursor: 'pointer', color: 'var(--text)', fontSize: 13 }}>
            <input type="checkbox" checked={value.diaCompleto} style={{ width: 'auto' }}
              onChange={e => onChange(e.target.checked
                ? { ...value, diaCompleto: true }
                : { ...value, diaCompleto: false, horaIni: TURNO_HORAS.dia.ini, horaFin: TURNO_HORAS.dia.fin })} />
            Día completo
          </label>
        </div>
        {!value.diaCompleto && camposHora}
      </>
    )
  }

  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, justifyContent: 'center' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, margin: 0, cursor: 'pointer', color: 'var(--text)', fontSize: 13 }}>
          <input type="radio" checked={!value.ambosTurnos} style={{ width: 'auto' }}
            onChange={() => onChange({
              ...value, ambosTurnos: false,
              horaIni: TURNO_HORAS[turno].ini, horaFin: TURNO_HORAS[turno].fin,
            })} />
          Solo turno {turno.toUpperCase()}
        </label>
        <label style={{
          display: 'flex', alignItems: 'center', gap: 6, margin: 0,
          cursor: otroLibre ? 'pointer' : 'not-allowed',
          color: otroLibre ? 'var(--text)' : 'var(--text3)', fontSize: 13,
        }}>
          <input type="radio" checked={value.ambosTurnos} disabled={!otroLibre} style={{ width: 'auto' }}
            onChange={() => onChange({
              ...value, ambosTurnos: true,
              horaIni: TURNO_HORAS.dia.ini, horaFin: TURNO_HORAS.dia.fin,
            })} />
          Día completo AM|PM
          {otroLibre === false && <span className="pill alerta">No disponible: turno {otro.toUpperCase()} ocupado</span>}
        </label>
      </div>
      {camposHora}
      {value.ambosTurnos && (
        <div style={{ flexBasis: '100%', fontSize: 12, color: 'var(--warning-text)', background: 'var(--warning-bg)', borderRadius: 8, padding: '8px 12px' }}>
          Se reservarán ambos turnos (AM y PM): el arriendo del día completo de
          fin de semana tiene un costo adicional sobre el de un solo turno.
        </div>
      )}
    </>
  )
}

// Campos de horario para la sesión (solo puestos full/compartido):
// "Todo el día" preseleccionado; al desmarcar, hora inicio/fin (9–22).
export function CamposHorario({ todoDia, horaIni, horaFin, onChange }: {
  todoDia: boolean
  horaIni: string
  horaFin: string
  onChange: (v: { todoDia: boolean; horaIni: string; horaFin: string }) => void
}) {
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', minWidth: 110 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, margin: 0, cursor: 'pointer', color: 'var(--text)', fontSize: 13 }}>
          <input type="checkbox" checked={todoDia} style={{ width: 'auto' }}
            onChange={e => onChange({ todoDia: e.target.checked, horaIni, horaFin })} />
          Todo el día
        </label>
      </div>
      {!todoDia && (
        <>
          <div style={{ maxWidth: 120 }}>
            <label>Hora inicio *</label>
            <input type="time" value={horaIni}
              onChange={e => onChange({ todoDia, horaIni: e.target.value, horaFin })} />
          </div>
          <div style={{ maxWidth: 120 }}>
            <label>Hora fin *</label>
            <input type="time" value={horaFin}
              onChange={e => onChange({ todoDia, horaIni, horaFin: e.target.value })} />
          </div>
        </>
      )}
    </>
  )
}

// Selector de puesto para una sesión, según el rol:
//  * tatuador full/compartido → su puesto propio (fijo)
//  * tatuador rotativo/guest  → SOLO los cupos que ya reservó ese día
//  * admin/host               → cualquier puesto
export function SelectorPuesto({ fecha, value, onChange, puestos, titulares, tatuadores }: {
  fecha: string
  value: string
  onChange: (v: string) => void
  puestos: Puesto[]
  titulares: PuestoTitular[]
  tatuadores: Tatuador[]
}) {
  const { sesion } = useSesion()
  const esTatuador = sesion?.rol === 'tatuador'
  const miId = sesion?.tatuadorId ?? null
  const [reservasFecha, setReservasFecha] = useState<Reserva[] | null>(null)

  const miTipo = esTatuador
    ? (tatuadores.find(t => t.id === miId)?.tipo_puesto ?? 'rotativo')
    : null
  const miPuestoPropio = esTatuador
    ? puestos.find(p => titulares.some(t => t.tatuador_id === miId && t.puesto_id === p.id)) ?? null
    : null

  const esRotativoOGuest = esTatuador && miTipo !== 'full' && miTipo !== 'compartido'

  useEffect(() => {
    if (!esRotativoOGuest || !fecha) { setReservasFecha(null); return }
    let cancelado = false
    supabase.from('reservas').select('*')
      .eq('fecha', fecha).eq('estado', 'activa')
      .then(({ data }) => { if (!cancelado) setReservasFecha((data as Reserva[]) ?? []) })
    return () => { cancelado = true }
  }, [fecha, esRotativoOGuest])

  // Full/compartido: su puesto fijo, autoseleccionado
  const puestoFijoId = (esTatuador && (miTipo === 'full' || miTipo === 'compartido'))
    ? (miPuestoPropio?.id ?? null) : null
  useEffect(() => {
    if (puestoFijoId && value !== puestoFijoId) onChange(puestoFijoId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [puestoFijoId, value])

  if (esTatuador && (miTipo === 'full' || miTipo === 'compartido')) {
    if (!miPuestoPropio) {
      return <span style={{ fontSize: 12, color: 'var(--danger-text)' }}>Sin puesto asignado — pide al admin que te asigne como titular</span>
    }
    return <input value={`${miPuestoPropio.nombre} (propio)`} readOnly
      style={{ background: 'var(--bg2)', color: 'var(--text2)', cursor: 'default' }} />
  }

  if (esRotativoOGuest) {
    const rotativos = puestos.filter(p => p.tipo === 'rotativo')
    const cupos: { id: string; label: string }[] = []
    if (fecha && reservasFecha) {
      rotativos.forEach((p, i) => {
        reservasFecha
          .filter(x => x.puesto_id === p.id && x.tatuador_id === miId)
          .forEach(r => cupos.push({
            id: `${p.id}::${r.bloque}`,
            label: `Día ${i + 1}${r.bloque !== 'dia' ? ` (${r.bloque.toUpperCase()})` : ''}`,
          }))
      })
    }
    if (fecha && reservasFecha && cupos.length === 0) {
      return (
        <span style={{ fontSize: 12, color: 'var(--danger-text)' }}>
          No hay puestos reservados para esa fecha — reserva primero en el Calendario
        </span>
      )
    }
    return (
      <select value={value} onChange={e => onChange(e.target.value)}>
        <option value="">— elegir puesto reservado —</option>
        {cupos.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
      </select>
    )
  }

  return (
    <select value={value} onChange={e => onChange(e.target.value)}>
      <option value="">—</option>
      {puestos.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
    </select>
  )
}
