// Lógica compartida de Sesiones: reglas de 24 h, asociación de
// consentimientos y sobreescritura de datos del cliente.
import { supabase } from './supabase'
import { Sesion, Consentimiento, normalizarRut } from './types'

const H24 = 24 * 60 * 60 * 1000

// Reglas de 24 horas (se aplican al cargar; no hay cron):
//  * consentimiento asociado sin firmar por 24 h → sesión cancelada
//  * consentimiento firmado sin cierre por 24 h  → sesión completada
// Devuelve las sesiones con los estados ya corregidos.
export async function aplicarReglas24h<T extends Sesion>(sesiones: T[]): Promise<T[]> {
  const ahora = Date.now()
  const resultado: T[] = []
  for (const s of sesiones) {
    let cambios: Partial<Sesion> | null = null
    if (
      s.estado === 'espera_consentimiento' &&
      s.consentimiento_id &&
      s.consentimiento_asociado_en &&
      ahora - new Date(s.consentimiento_asociado_en).getTime() > H24
    ) {
      cambios = { estado: 'cancelada', observacion: s.observacion ?? 'Consentimiento no firmado en 24 horas' }
    } else if (
      s.estado === 'consentimiento_firmado' &&
      s.consentimiento_firmado_en &&
      ahora - new Date(s.consentimiento_firmado_en).getTime() > H24
    ) {
      cambios = { estado: 'completada' }
    }
    if (cambios) {
      await supabase.from('sesiones')
        .update({ ...cambios, updated_at: new Date().toISOString() }).eq('id', s.id)
      resultado.push({ ...s, ...cambios })
    } else {
      resultado.push(s)
    }
  }
  return resultado
}

// Asociar un consentimiento a una sesión:
//  1. La información oficial del consentimiento sobreescribe los datos
//     provisorios del cliente del proyecto (si el RUT ya existía en otro
//     cliente, el proyecto se re-apunta a ese cliente real).
//  2. Si el consentimiento no tiene los datos del trabajo, se prellenan
//     desde el proyecto.
//  3. La sesión queda vinculada con timestamp de asociación.
export async function asociarConsentimiento(
  sesion: Sesion,
  cons: Consentimiento,
): Promise<{ error?: string }> {
  // Proyecto y cliente actual
  const { data: proyecto } = await supabase.from('proyectos')
    .select('id, cliente_id, descripcion, zona, tamano, a_color, estilo_id')
    .eq('id', sesion.proyecto_id).single()
  if (!proyecto) return { error: 'Proyecto no encontrado' }

  const rutNorm = normalizarRut(cons.rut)
  const datosOficiales = {
    nombre: cons.nombre,
    telefono: cons.telefono || null,
    direccion: cons.direccion || null,
    nacimiento: cons.nacimiento || null,
    updated_at: new Date().toISOString(),
  }

  let clienteId = proyecto.cliente_id as string | null
  if (rutNorm) {
    // ¿Existe ya un cliente real con ese RUT?
    const { data: existente } = await supabase.from('clientes')
      .select('id').eq('rut', rutNorm).maybeSingle()
    if (existente && existente.id !== clienteId) {
      // Cliente real ya registrado: usarlo y actualizar sus datos oficiales
      await supabase.from('clientes').update(datosOficiales).eq('id', existente.id)
      clienteId = existente.id
      await supabase.from('proyectos')
        .update({ cliente_id: clienteId, updated_at: new Date().toISOString() })
        .eq('id', proyecto.id)
    } else if (clienteId) {
      // Sobrescribir el cliente provisorio con la info oficial (incluido el RUT)
      await supabase.from('clientes').update({ ...datosOficiales, rut: rutNorm }).eq('id', clienteId)
    } else {
      const { data: nuevo } = await supabase.from('clientes')
        .insert({ ...datosOficiales, rut: rutNorm }).select('id').single()
      clienteId = nuevo?.id ?? null
      if (clienteId) {
        await supabase.from('proyectos')
          .update({ cliente_id: clienteId, updated_at: new Date().toISOString() })
          .eq('id', proyecto.id)
      }
    }
  } else if (clienteId) {
    await supabase.from('clientes').update(datosOficiales).eq('id', clienteId)
  }

  // Nota: los datos del trabajo del consentimiento NO se escriben aquí;
  // el formulario de la sesión los prellena desde el proyecto y el
  // tatuador los confirma/edita antes de imprimir.
  const { error } = await supabase.from('sesiones').update({
    consentimiento_id: cons.id,
    consentimiento_asociado_en: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('id', sesion.id)
  return error ? { error: error.message } : {}
}

// Desasociar (solo si aún no está firmado)
export async function desasociarConsentimiento(sesion: Sesion): Promise<void> {
  await supabase.from('sesiones').update({
    consentimiento_id: null,
    consentimiento_asociado_en: null,
    updated_at: new Date().toISOString(),
  }).eq('id', sesion.id)
}

// Marcar la sesión como firmada (tras imprimir y firmar el consentimiento)
export async function marcarSesionFirmada(sesionId: string): Promise<void> {
  const ahora = new Date().toISOString()
  await supabase.from('sesiones').update({
    estado: 'consentimiento_firmado',
    consentimiento_firmado_en: ahora,
    updated_at: ahora,
  }).eq('id', sesionId)
}
