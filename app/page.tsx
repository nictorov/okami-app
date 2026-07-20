'use client'
import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import {
  Puesto, PuestoTitular, PuestoSemaforo, Tatuador, Sesion,
} from '@/lib/types'
import { Reserva, esFinDeSemana, formatHorario } from '@/lib/reservas'
import SoloRoles from '@/components/SoloRoles'

const SEMAFORO_LABEL: Record<PuestoSemaforo, string> = {
  libre: 'Libre',
  reservado: 'Reservado',
  en_uso: 'En uso',
  fuera_sistema: 'Fuera del sistema',
  inactivo: 'Inactivo',
}

const TIPO_LABEL: Record<string, string> = {
  full: 'Full', compartido: 'Compartido', rotativo: 'Rotativo',
}

function hoyISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

// "Lunes 13 Jul 2026"
function tituloFecha(fechaISO: string): string {
  const d = new Date(`${fechaISO}T12:00:00`)
  const dia = cap(d.toLocaleDateString('es-CL', { weekday: 'long' }))
  const mes = cap(d.toLocaleDateString('es-CL', { month: 'short' }).replace('.', ''))
  return `${dia} ${d.getDate()} ${mes} ${d.getFullYear()}`
}

function PanelPage() {
  const [fecha, setFecha] = useState(hoyISO())
  const [loading, setLoading] = useState(true)
  const [puestos, setPuestos] = useState<Puesto[]>([])
  const [titulares, setTitulares] = useState<PuestoTitular[]>([])
  const [reservas, setReservas] = useState<Reserva[]>([])
  const [sesiones, setSesiones] = useState<Sesion[]>([])
  const [tatuadores, setTatuadores] = useState<Tatuador[]>([])

  const cargar = useCallback(async () => {
    setLoading(true)
    const inicioDia = `${fecha}T00:00:00`
    const finDia = `${fecha}T23:59:59`
    const [p, t, r, se, tat] = await Promise.all([
      supabase.from('puestos').select('*').order('orden'),
      supabase.from('puesto_titulares').select('*'),
      supabase.from('reservas').select('*').eq('fecha', fecha).eq('estado', 'activa'),
      supabase.from('sesiones').select('*')
        .gte('inicio', inicioDia).lte('inicio', finDia)
        .not('estado', 'in', '(cancelada)'),
      // Todos los tatuadores: las reservas de archivados deben mostrar su nombre
      supabase.from('tatuadores').select('*'),
    ])
    setPuestos(p.data ?? [])
    setTitulares(t.data ?? [])
    setReservas((r.data as Reserva[]) ?? [])
    setSesiones(se.data ?? [])
    setTatuadores(tat.data ?? [])
    setLoading(false)
  }, [fecha])

  useEffect(() => { cargar() }, [cargar])

  function nombreTatuador(id: string | null): string {
    if (!id) return ''
    const t = tatuadores.find(x => x.id === id)
    return t ? (t.nombre_artistico || t.nombre) : ''
  }

  // "Día N" de cada puesto rotativo, según su orden
  const rotativoIdx: Record<string, number> = {}
  puestos.filter(p => p.tipo === 'rotativo').forEach((p, i) => { rotativoIdx[p.id] = i + 1 })

  function estadoPuesto(p: Puesto): PuestoSemaforo {
    if (!p.activo) return 'inactivo'
    if (!p.gestionado) return 'fuera_sistema'
    const sesPuesto = sesiones.filter(s => s.puesto_id === p.id)
    if (sesPuesto.some(s => s.estado === 'consentimiento_firmado')) return 'en_uso'
    const resPuesto = reservas.filter(r => r.puesto_id === p.id)
    if (resPuesto.length > 0 || sesPuesto.some(s => s.estado === 'espera_consentimiento')) return 'reservado'
    return 'libre'
  }

  // Texto de reservas del puesto (con AM/PM en fines de semana rotativos
  // y horario cuando la reserva es por tramo)
  function reservasTexto(p: Puesto): string {
    const finde = esFinDeSemana(fecha)
    return reservas.filter(r => r.puesto_id === p.id).map(r => {
      const suf = (finde && p.tipo === 'rotativo' && r.bloque !== 'dia') ? ` (${r.bloque.toUpperCase()})` : ''
      const horario = r.hora_inicio ? ` ${formatHorario(r.hora_inicio, r.hora_fin)}` : ''
      return nombreTatuador(r.tatuador_id) + suf + horario
    }).join(', ')
  }

  const resumen = puestos.reduce((acc, p) => {
    acc[estadoPuesto(p)] = (acc[estadoPuesto(p)] ?? 0) + 1
    return acc
  }, {} as Record<string, number>)

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <h1>Panel — {tituloFecha(fecha)}</h1>
          <input type="date" value={fecha} onChange={e => e.target.value && setFecha(e.target.value)}
            style={{ width: 160 }} />
          {fecha !== hoyISO() && (
            <button className="chico secundario" onClick={() => setFecha(hoyISO())}>Hoy</button>
          )}
        </div>
        <div style={{ display: 'flex', gap: 12, fontSize: '0.82rem', color: 'var(--text2)', flexWrap: 'wrap' }}>
          {(['libre', 'reservado', 'en_uso', 'fuera_sistema'] as PuestoSemaforo[]).map(s => (
            <span key={s}><span className={`dot ${s}`} />{SEMAFORO_LABEL[s]} ({resumen[s] ?? 0})</span>
          ))}
        </div>
      </div>

      {loading ? <div className="spinner" /> : (
        <div className="grilla-puestos">
          {puestos.map(p => {
            const estado = estadoPuesto(p)
            const tits = titulares.filter(t => t.puesto_id === p.id).map(t => nombreTatuador(t.tatuador_id))
            const resTxt = reservasTexto(p)
            const sesPuesto = sesiones.filter(s => s.puesto_id === p.id)
            return (
              <div key={p.id} className={`puesto-card ${estado}`}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <strong>{p.nombre}</strong>
                  <span className="pill">{TIPO_LABEL[p.tipo] ?? p.tipo}{p.tipo === 'rotativo' && rotativoIdx[p.id] ? ` · Día ${rotativoIdx[p.id]}` : ''}</span>
                </div>

                {/* Titulares (full/compartido) */}
                {p.tipo !== 'rotativo' && tits.length > 0 && (
                  <div style={{ fontSize: '0.8rem', color: 'var(--text2)', marginBottom: 4 }}>
                    {tits.join(' / ')}
                  </div>
                )}

                <div style={{ fontSize: '0.82rem', marginBottom: 4 }}>
                  <span className={`dot ${estado}`} />{SEMAFORO_LABEL[estado]}
                </div>

                {/* Reservas del día */}
                {resTxt && (
                  <div style={{ fontSize: '0.8rem', color: 'var(--text2)' }}>
                    Reservado: {resTxt}
                  </div>
                )}

                {/* Sesiones del día */}
                {sesPuesto.map(a => (
                  <div key={a.id} style={{ fontSize: '0.78rem', color: 'var(--text3)', marginTop: 4 }}>
                    {new Date(a.inicio).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}
                    {a.hora_fin ? `–${a.hora_fin.slice(0, 5)}` : ''}
                    {' · '}{nombreTatuador(a.tatuador_id)}
                  </div>
                ))}
              </div>
            )
          })}
        </div>
      )}

      {!loading && puestos.length === 0 && (
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
