'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import {
  Puesto, PuestoTitular, PuestoAsignacion, PuestoSemaforo,
  Tatuador, Sesion,
} from '@/lib/types'
import SoloRoles from '@/components/SoloRoles'

const SEMAFORO_LABEL: Record<PuestoSemaforo, string> = {
  libre: 'Libre',
  reservado: 'Reservado',
  en_uso: 'En uso',
  fuera_sistema: 'Fuera del sistema',
  inactivo: 'Inactivo',
}

function hoyISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function PanelPage() {
  const [loading, setLoading] = useState(true)
  const [puestos, setPuestos] = useState<Puesto[]>([])
  const [titulares, setTitulares] = useState<PuestoTitular[]>([])
  const [asignaciones, setAsignaciones] = useState<PuestoAsignacion[]>([])
  const [sesiones, setSesiones] = useState<Sesion[]>([])
  const [tatuadores, setTatuadores] = useState<Tatuador[]>([])

  useEffect(() => {
    async function cargar() {
      const hoy = hoyISO()
      const inicioDia = `${hoy}T00:00:00`
      const finDia = `${hoy}T23:59:59`
      const [p, t, a, se, tat] = await Promise.all([
        supabase.from('puestos').select('*').order('orden'),
        supabase.from('puesto_titulares').select('*'),
        supabase.from('puesto_asignaciones').select('*').eq('fecha', hoy),
        supabase.from('sesiones').select('*')
          .gte('inicio', inicioDia).lte('inicio', finDia)
          .in('estado', ['espera_consentimiento', 'consentimiento_firmado']),
        supabase.from('tatuadores').select('*').eq('activo', true),
      ])
      setPuestos(p.data ?? [])
      setTitulares(t.data ?? [])
      setAsignaciones(a.data ?? [])
      setSesiones(se.data ?? [])
      setTatuadores(tat.data ?? [])
      setLoading(false)
    }
    cargar()
  }, [])

  function nombreTatuador(id: string | null): string {
    if (!id) return ''
    const t = tatuadores.find(x => x.id === id)
    return t ? (t.nombre_artistico || t.nombre) : ''
  }

  function estadoPuesto(p: Puesto): PuestoSemaforo {
    if (!p.activo) return 'inactivo'
    if (!p.gestionado) return 'fuera_sistema'
    const sesPuesto = sesiones.filter(s => s.puesto_id === p.id)
    if (sesPuesto.some(s => s.estado === 'consentimiento_firmado')) return 'en_uso'
    if (sesPuesto.some(s => s.estado === 'espera_consentimiento')) return 'reservado'
    return 'libre'
  }

  function ocupantes(p: Puesto): string {
    const asig = asignaciones.filter(a => a.puesto_id === p.id)
    if (asig.length > 0) {
      return asig.map(a => {
        const sufijo = a.bloque === 'am' ? ' (AM)' : a.bloque === 'pm' ? ' (PM)' : ''
        return nombreTatuador(a.tatuador_id) + sufijo
      }).join(', ')
    }
    const tits = titulares.filter(t => t.puesto_id === p.id)
    return tits.map(t => nombreTatuador(t.tatuador_id)).join(', ')
  }

  // Alertas de documentación sanitaria
  const hoy = hoyISO()
  const alertasDocs = tatuadores
    .filter(t => t.en_sistema)
    .map(t => {
      const problemas: string[] = []
      if (!t.vacunacion_vence) problemas.push('sin carnet de vacunación')
      else if (t.vacunacion_vence < hoy) problemas.push('vacunación vencida')
      if (!t.asepsia_vence) problemas.push('sin curso de asepsia')
      else if (t.asepsia_vence < hoy) problemas.push('asepsia vencida')
      return { t, problemas }
    })
    .filter(x => x.problemas.length > 0)

  if (loading) return <div className="spinner" />

  const resumen = puestos.reduce((acc, p) => {
    acc[estadoPuesto(p)] = (acc[estadoPuesto(p)] ?? 0) + 1
    return acc
  }, {} as Record<string, number>)

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8, marginBottom: 18 }}>
        <h1>Panel del día</h1>
        <div style={{ display: 'flex', gap: 12, fontSize: '0.82rem', color: 'var(--text2)', flexWrap: 'wrap' }}>
          {(['libre', 'reservado', 'en_uso', 'fuera_sistema'] as PuestoSemaforo[]).map(s => (
            <span key={s}><span className={`dot ${s}`} />{SEMAFORO_LABEL[s]} ({resumen[s] ?? 0})</span>
          ))}
        </div>
      </div>

      {alertasDocs.length > 0 && (
        <div className="card" style={{ marginBottom: 18, borderColor: 'var(--amarillo)' }}>
          <h3 style={{ color: 'var(--amarillo)', marginBottom: 8 }}>⚠ Documentación pendiente</h3>
          {alertasDocs.map(({ t, problemas }) => (
            <div key={t.id} style={{ fontSize: '0.85rem', color: 'var(--text2)', padding: '2px 0' }}>
              <strong style={{ color: 'var(--text)' }}>{t.nombre_artistico || t.nombre}</strong>: {problemas.join(', ')}
            </div>
          ))}
        </div>
      )}

      <div className="grilla-puestos">
        {puestos.map(p => {
          const estado = estadoPuesto(p)
          const quienes = ocupantes(p)
          const atsHoy = sesiones.filter(s => s.puesto_id === p.id)
          return (
            <div key={p.id} className={`puesto-card ${estado}`}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <strong>{p.nombre}</strong>
                <span className="pill">{p.tipo}</span>
              </div>
              <div style={{ fontSize: '0.82rem', marginBottom: 4 }}>
                <span className={`dot ${estado}`} />{SEMAFORO_LABEL[estado]}
              </div>
              {quienes && (
                <div style={{ fontSize: '0.82rem', color: 'var(--text2)' }}>{quienes}</div>
              )}
              {atsHoy.map(a => (
                <div key={a.id} style={{ fontSize: '0.78rem', color: 'var(--text3)', marginTop: 4 }}>
                  {new Date(a.inicio).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}
                  {' · '}{nombreTatuador(a.tatuador_id)}
                </div>
              ))}
            </div>
          )
        })}
      </div>

      {puestos.length === 0 && (
        <div className="vacio">
          No hay puestos configurados. ¿Ejecutaste las migraciones SQL?{' '}
          <Link href="/puestos" style={{ color: 'var(--accent)' }}>Configurar puestos</Link>
        </div>
      )}
    </div>
  )
}

export default function PanelPageProtegida() {
  return <SoloRoles roles={['admin', 'host']}><PanelPage /></SoloRoles>
}
