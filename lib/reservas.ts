// Lógica compartida de reservas de puesto
import { supabase } from './supabase'

export type Bloque = 'dia' | 'am' | 'pm'

export interface Reserva {
  id: string
  fecha: string           // date ISO
  bloque: Bloque
  puesto_id: string
  tatuador_id: string
  creada_por: 'tatuador' | 'host' | 'admin'
  estado: 'activa' | 'cancelada'
  cancelada_en: string | null
  notas: string | null
  created_at: string
}

export function hoyISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function esFinDeSemana(fechaISO: string): boolean {
  const dia = new Date(`${fechaISO}T12:00:00`).getDay()
  return dia === 0 || dia === 6
}

// Lun–Vie: día completo. Sáb–Dom: turnos AM (9:00–15:30) y PM (16:00–23:00)
export function bloquesDe(fechaISO: string): Bloque[] {
  return esFinDeSemana(fechaISO) ? ['am', 'pm'] : ['dia']
}

export const BLOQUE_LABEL: Record<Bloque, string> = {
  dia: 'Día completo',
  am: 'AM 9:00–15:30',
  pm: 'PM 16:00–23:00',
}

// Deriva el bloque desde la hora de una sesión (para fines de semana)
export function bloqueDesdeHora(fechaISO: string, hora: string): Bloque {
  if (!esFinDeSemana(fechaISO)) return 'dia'
  return hora < '15:31' ? 'am' : 'pm'
}

// Cancelación: hasta el mismo día en semana; fin de semana con 1 día
// de anticipación.
export function puedeCancelar(reserva: Pick<Reserva, 'fecha'>): boolean {
  const hoy = hoyISO()
  if (esFinDeSemana(reserva.fecha)) return reserva.fecha > hoy
  return reserva.fecha >= hoy
}

// Crea una reserva; el índice único de la base rechaza el doble bloqueo.
// Si el mismo tatuador ya tenía la reserva, no es error.
export async function crearReserva(args: {
  fecha: string
  bloque: Bloque
  puesto_id: string
  tatuador_id: string
  creada_por: 'tatuador' | 'host' | 'admin'
  notas?: string
}): Promise<{ error?: string }> {
  const { error } = await supabase.from('reservas').insert({
    fecha: args.fecha,
    bloque: args.bloque,
    puesto_id: args.puesto_id,
    tatuador_id: args.tatuador_id,
    creada_por: args.creada_por,
    notas: args.notas ?? null,
  })
  if (!error) return {}
  if (error.code === '23505') {
    // Ya existe una reserva activa en ese puesto/fecha/bloque
    const { data } = await supabase.from('reservas')
      .select('tatuador_id').eq('puesto_id', args.puesto_id)
      .eq('fecha', args.fecha).eq('bloque', args.bloque)
      .eq('estado', 'activa').maybeSingle()
    if (data?.tatuador_id === args.tatuador_id) return {}  // ya era suya
    return { error: 'Ese puesto ya está reservado para esa fecha/turno.' }
  }
  return { error: error.message }
}

export async function cancelarReserva(id: string): Promise<void> {
  await supabase.from('reservas').update({
    estado: 'cancelada',
    cancelada_en: new Date().toISOString(),
  }).eq('id', id)
}
