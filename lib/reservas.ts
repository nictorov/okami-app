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
  hora_inicio: string | null  // 'HH:MM:SS' — NULL = día completo
  hora_fin: string | null
  cancelada_en: string | null
  notas: string | null
  created_at: string
}

// ── Horarios (full/compartido pueden reservar por tramo) ──

export function horaCorta(h: string): string {
  return h.slice(0, 5)
}

export function formatHorario(ini: string | null | undefined, fin: string | null | undefined): string {
  if (!ini || !fin) return ''
  return `${horaCorta(ini)}–${horaCorta(fin)}`
}

export function minutosDe(h: string): number {
  const [hh, mm] = h.split(':').map(Number)
  return hh * 60 + (mm || 0)
}

export function seSolapan(aIni: number, aFin: number, bIni: number, bFin: number): boolean {
  return aIni < bFin && bIni < aFin
}

// Rango en minutos de una reserva; sin horario = día completo
export function rangoDeReserva(r: Pick<Reserva, 'hora_inicio' | 'hora_fin'>): [number, number] {
  return [
    r.hora_inicio ? minutosDe(r.hora_inicio) : 0,
    r.hora_fin ? minutosDe(r.hora_fin) : 1440,
  ]
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

// Crea una reserva; la base rechaza el doble bloqueo (topes de horario:
// restricción de exclusión, código 23P01; o índice único antiguo, 23505).
// Si el tope es solo con reservas del mismo tatuador, no es error.
export async function crearReserva(args: {
  fecha: string
  bloque: Bloque
  puesto_id: string
  tatuador_id: string
  creada_por: 'tatuador' | 'host' | 'admin'
  hora_inicio?: string   // 'HH:MM' — juntas o ninguna; sin horas = día completo
  hora_fin?: string
  notas?: string
}): Promise<{ error?: string }> {
  const fila: Record<string, unknown> = {
    fecha: args.fecha,
    bloque: args.bloque,
    puesto_id: args.puesto_id,
    tatuador_id: args.tatuador_id,
    creada_por: args.creada_por,
    notas: args.notas ?? null,
  }
  if (args.hora_inicio && args.hora_fin) {
    fila.hora_inicio = args.hora_inicio
    fila.hora_fin = args.hora_fin
  }
  const { error } = await supabase.from('reservas').insert(fila)
  if (!error) return {}
  if (error.code === '23505' || error.code === '23P01') {
    // Tope: buscar con qué reservas activas choca el horario pedido
    const { data } = await supabase.from('reservas').select('*')
      .eq('puesto_id', args.puesto_id)
      .eq('fecha', args.fecha).eq('bloque', args.bloque)
      .eq('estado', 'activa')
    const ini = args.hora_inicio ? minutosDe(args.hora_inicio) : 0
    const fin = args.hora_fin ? minutosDe(args.hora_fin) : 1440
    const enTope = ((data as Reserva[]) ?? []).filter(r => {
      const [a, b] = rangoDeReserva(r)
      return seSolapan(ini, fin, a, b)
    })
    if (enTope.length > 0 && enTope.every(r => r.tatuador_id === args.tatuador_id)) {
      return {}  // ya era suya (o su propia reserva cubre el horario)
    }
    const horarios = enTope
      .filter(r => r.hora_inicio)
      .map(r => formatHorario(r.hora_inicio, r.hora_fin))
      .join(', ')
    return {
      error: horarios
        ? `Tope de horario: ese puesto ya está reservado de ${horarios} ese día.`
        : 'Ese puesto ya está reservado para esa fecha/turno.',
    }
  }
  return { error: error.message }
}

export async function cancelarReserva(id: string): Promise<void> {
  await supabase.from('reservas').update({
    estado: 'cancelada',
    cancelada_en: new Date().toISOString(),
  }).eq('id', id)
}
