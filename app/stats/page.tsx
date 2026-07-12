'use client'
import SoloRoles from '@/components/SoloRoles'

export default function StatsPage() {
  return (
    <SoloRoles roles={['admin']}>
      <div>
        <h1 style={{ marginBottom: 12 }}>Estadísticas</h1>
        <div className="card vacio">
          Módulo de Fase 3 — precios por estilo/zona/tamaño, embudo de conversión de
          cotizaciones, ingresos por tatuador, frecuencia de clientes y reparto de trabajos.
        </div>
      </div>
    </SoloRoles>
  )
}
