'use client'
// Lógica compartida para agendar sesiones: selector de puesto según rol
// y creación de la reserva que bloquea el puesto.
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Puesto, PuestoTitular, Tatuador } from '@/lib/types'
import { Reserva, Bloque, bloqueDesdeHora, crearReserva } from '@/lib/reservas'
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
export async function asegurarReserva(args: {
  puestos: Puesto[]
  puestoId: string
  bloqueForzado?: Bloque
  fecha: string
  hora: string
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
  })
  if (!error) return true
  if (args.rol !== 'tatuador') return confirm(`${error} ¿Crear la sesión de todos modos?`)
  alert(error)
  return false
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
