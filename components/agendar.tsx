'use client'
// Lógica compartida para agendar sesiones: selector de puesto según rol
// y creación de la reserva que bloquea el puesto.
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Puesto, PuestoTitular, Tatuador } from '@/lib/types'
import {
  Reserva, Bloque, bloqueDesdeHora, crearReserva,
  minutosDe, seSolapan, horaCorta,
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
  fecha: string
  hora: string
  horaInicio?: string
  horaFin?: string
  tatuadorId: string
  rol: 'tatuador' | 'host' | 'admin'
}): Promise<boolean> {
  const p = args.puestos.find(x => x.id === args.puestoId)
  if (!p || p.tipo === 'full') return true
  const bloque = args.bloqueForzado
    ?? (p.tipo === 'rotativo' ? bloqueDesdeHora(args.fecha, args.hora) : 'dia')
  const { error } = await crearReserva({
    fecha: args.fecha,
    bloque,
    puesto_id: args.puestoId,
    tatuador_id: args.tatuadorId,
    creada_por: args.rol,
    hora_inicio: args.horaInicio,
    hora_fin: args.horaFin,
  })
  if (!error) return true
  if (args.rol !== 'tatuador') return confirm(`${error} ¿Crear la sesión de todos modos?`)
  alert(error)
  return false
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
