// Reglas de cobro de arriendo por tipo de tatuador.
//  full / compartido: monto mensual fijo (editable en su ficha).
//  rotativo: $12.000 por día de semana o turno de finde reservado;
//            $20.000 si reserva ambos turnos de un mismo finde;
//            mínimo mensual (por defecto $60.000, editable).
//  guest: $15.000 día/turno y $25.000 día completo de finde; si reserva
//         5 o más días en el mes, baja a la tarifa rotativa.
import { Reserva } from './reservas'

export const ARRIENDO_DEFAULT: Record<string, number | null> = {
  full: 220000,
  compartido: 120000,
  rotativo: 60000,   // mínimo mensual
  guest: null,       // tarifas guest, sin monto fijo
}

const ROT_UNIT = 12000, ROT_DOBLE = 20000
const GUEST_UNIT = 15000, GUEST_DOBLE = 25000

function bloquesPorFecha(reservas: Reserva[]): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>()
  for (const r of reservas) {
    const set = m.get(r.fecha) ?? new Set<string>()
    set.add(r.bloque)
    m.set(r.fecha, set)
  }
  return m
}

// Arriendo de un rotativo en un mes, según sus reservas activas
export function arriendoRotativo(reservas: Reserva[], minimoMensual: number): {
  total: number; detalle: number; aplicaMinimo: boolean
} {
  let detalle = 0
  bloquesPorFecha(reservas).forEach(bloques => {
    if (bloques.has('am') && bloques.has('pm')) detalle += ROT_DOBLE
    else detalle += ROT_UNIT * bloques.size
  })
  const total = Math.max(detalle, minimoMensual)
  return { total, detalle, aplicaMinimo: detalle < minimoMensual }
}

// Arriendo de un guest en un mes, según sus reservas activas
export function arriendoGuest(reservas: Reserva[]): {
  total: number; dias: number; tarifaRebajada: boolean
} {
  const porFecha = bloquesPorFecha(reservas)
  const dias = porFecha.size
  const rebaja = dias >= 5
  const unit = rebaja ? ROT_UNIT : GUEST_UNIT
  const doble = rebaja ? ROT_DOBLE : GUEST_DOBLE
  let total = 0
  porFecha.forEach(bloques => {
    if (bloques.has('am') && bloques.has('pm')) total += doble
    else total += unit * bloques.size
  })
  return { total, dias, tarifaRebajada: rebaja }
}
