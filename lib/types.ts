// ============================================================
// Okami APP 2.0 — Tipos
// Reflejan el schema de supabase/migrations/001_okami_app_schema.sql
// ============================================================

// --- Tatuadores (tabla existente `tatuadores` + columnas nuevas) ---
export interface Tatuador {
  id: string
  nombre: string
  nombre_artistico: string | null
  rut: string | null
  nacimiento: string | null
  telefono: string | null
  email: string | null
  instagram: string | null
  activo: boolean
  archivado: boolean
  eliminado: boolean
  archivado_en: string | null
  pin: string | null       // clave de acceso del tatuador a la APP
  orden: number
  tipo_puesto: 'full' | 'compartido' | 'rotativo' | 'guest' | null
  participa_cotizaciones: boolean
  en_sistema: boolean
  google_calendar_id: string | null
  vacunacion_vence: string | null   // date ISO — NULL = no presentada
  asepsia_vence: string | null
  notas: string | null
}

export interface Estilo {
  id: string
  nombre: string
  orden: number
  activo: boolean
}

export interface TatuadorEstilo {
  id: string
  tatuador_id: string
  estilo_id: string
  nivel: number           // 1–5
  maneja_color: boolean
  estilo?: Estilo
}

// --- Clientes ---
export interface Cliente {
  id: string
  rut: string | null      // normalizado (sin puntos ni guión)
  nombre: string
  telefono: string | null
  email: string | null
  direccion: string | null
  nacimiento: string | null
  instagram: string | null
  como_nos_conocio: string | null
  marketing_ok: boolean
  notas: string | null
  tatuador_id: string | null   // dueño: tatuador que lo agendó directo (NULL = del estudio)
  created_at: string
  updated_at: string
}

// --- Proyectos y Sesiones (modelo actual) ---
export type ProyectoEstado = 'activo' | 'completado' | 'cancelado'

export interface Proyecto {
  id: string
  folio: string
  cliente_id: string | null
  tatuador_id: string
  creado_por: 'tatuador' | 'host' | 'admin'
  desde_okami: boolean
  descripcion: string | null
  estilo_id: string | null
  a_color: boolean | null
  zona: string | null
  tamano: string | null
  comentarios: string | null
  estado: ProyectoEstado
  created_at: string
  updated_at: string
}

export type SesionEstado =
  | 'espera_consentimiento' | 'consentimiento_firmado'
  | 'completada' | 'incompleta' | 'cancelada'

export interface Sesion {
  id: string
  proyecto_id: string
  tatuador_id: string
  numero: number
  inicio: string
  puesto_id: string | null
  valor: number
  abono: number
  abonado: boolean
  consentimiento_id: string | null
  consentimiento_asociado_en: string | null
  consentimiento_firmado_en: string | null
  estado: SesionEstado
  observacion: string | null
  created_at: string
  updated_at: string
}

export const SESION_ESTADO_LABEL: Record<SesionEstado, string> = {
  espera_consentimiento: 'En espera consentimiento',
  consentimiento_firmado: 'Consentimiento firmado',
  completada: 'Completada',
  incompleta: 'Incompleta',
  cancelada: 'Cancelada',
}

// --- Cotizaciones (modelo anterior, conservado como histórico) ---
export type CotizacionEstado =
  | 'nueva' | 'asignada' | 'cotizada' | 'aceptada'
  | 'agendada' | 'atendida' | 'perdida'

export type CotizacionOrigen =
  | 'estudio' | 'directa_tatuador' | 'instagram' | 'walk_in' | 'web' | 'otro'

export interface Cotizacion {
  id: string
  folio: string
  cliente_id: string | null
  contacto_nombre: string | null
  contacto_medio: string | null
  origen: CotizacionOrigen
  descripcion: string | null
  zona: string | null
  tamano: string | null
  estilo_id: string | null
  a_color: boolean | null
  referencias: string[] | null
  precio_cotizado: number | null
  sesiones_estimadas: number
  derivada: boolean
  contacto_instagram: string | null
  contacto_email: string | null
  contacto_telefono: string | null
  tatuador_id: string | null
  estado: CotizacionEstado
  motivo_perdida: string | null
  notas: string | null
  created_at: string
  updated_at: string
}

// --- Puestos ---
export type PuestoTipo = 'full' | 'compartido' | 'rotativo'

export interface Puesto {
  id: string
  nombre: string
  tipo: PuestoTipo
  gestionado: boolean     // false → gris "fuera del sistema" en el panel
  activo: boolean
  orden: number
  notas: string | null
}

export interface PuestoTitular {
  id: string
  puesto_id: string
  tatuador_id: string
}

export interface PuestoAsignacion {
  id: string
  puesto_id: string
  tatuador_id: string
  fecha: string           // date ISO
  bloque: 'dia' | 'am' | 'pm'
  notas: string | null
}

// Estado calculado para el semáforo del panel
export type PuestoSemaforo = 'libre' | 'reservado' | 'en_uso' | 'fuera_sistema' | 'inactivo'

// --- Atenciones ---
export type AtencionEstado =
  | 'agendada' | 'en_curso' | 'completada' | 'cancelada' | 'no_show'

// Cómo llegó el cliente (ver migración 006)
export type AtencionTipo =
  | 'agenda_privada' | 'agenda_okami' | 'desde_okami' | 'cotizacion_okami'

export interface Atencion {
  id: string
  cotizacion_id: string | null
  cliente_id: string | null
  tatuador_id: string
  consentimiento_id: string | null  // se vincula cuando el cliente firma
  puesto_id: string | null
  tipo: AtencionTipo
  inicio: string
  fin: string | null
  sesion_numero: number
  sesiones_total: number
  precio_final: number | null
  metodo_pago: string | null
  abono: number
  comision_estudio: number | null
  monto_tatuador: number | null
  costo_insumos: number
  costo_otros: number
  estado: AtencionEstado
  cancelada_en: string | null
  cancelada_por: 'cliente' | 'tatuador' | 'estudio' | null
  motivo_cancelacion: string | null
  notas: string | null
  created_at: string
  updated_at: string
}

export interface AtencionInsumo {
  id: string
  atencion_id: string
  producto_id: string | null        // FK a vitrina_products
  descripcion: string | null
  cantidad: number
  costo_unitario: number            // congelado al momento de uso
}

// --- Agenda ---
export interface AgendaBloque {
  id: string
  tatuador_id: string
  fecha: string
  hora_inicio: string
  hora_fin: string
  disponible: boolean
  notas: string | null
}

// --- Consentimientos (tabla existente `consentimientos`, compartida con
//     la app original; esta app también escribe en ella) ---
export interface Tutor {
  nombre: string
  rut: string
  telefono?: string | null
  parentesco?: string
  direccion?: string | null
}

export interface TatuadorDatos {
  nombre: string
  rut: string
  nac?: string
  tel?: string
}

export interface Consentimiento {
  id?: string
  folio: string
  nombre: string
  rut: string
  nacimiento?: string
  edad?: number | string
  telefono?: string
  direccion?: string
  tatuador: string
  tatuador_otro?: string
  tatuador_datos?: TatuadorDatos
  descripcion?: string
  zona?: string
  tipo_tatuaje?: string
  condiciones_medicas?: string
  work_filled: boolean
  menor: boolean
  tutor?: Tutor
  estado: 'pendiente' | 'impreso' | 'firmado' | 'expirado'
  created_at?: string
  fecha_display?: string
  hora_display?: string
  firmado_en?: string
  impreso_en?: string
}

export interface ConsentimientoResumen {
  id: string
  folio: string
  nombre: string
  rut: string
  tatuador: string
  estado: string
  created_at: string
  firmado_en: string | null
}

// --- Utilidades ---
export function formatCLP(n: number | null | undefined): string {
  if (n == null) return '—'
  return '$' + n.toLocaleString('es-CL')
}

export function formatRut(raw: string | null | undefined): string {
  if (!raw) return ''
  const clean = raw.replace(/[^0-9kK]/g, '').toUpperCase()
  if (clean.length < 2) return clean
  const dv = clean.slice(-1), body = clean.slice(0, -1)
  return body.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + '-' + dv
}

export function normalizarRut(raw: string): string {
  return raw.replace(/[^0-9kK]/g, '').toUpperCase()
}
