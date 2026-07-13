'use client'
import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { Puesto, PuestoTitular, PuestoTipo, Tatuador } from '@/lib/types'
import SoloRoles from '@/components/SoloRoles'

function PuestosPage() {
  const [loading, setLoading] = useState(true)
  const [puestos, setPuestos] = useState<Puesto[]>([])
  const [titulares, setTitulares] = useState<PuestoTitular[]>([])
  const [tatuadores, setTatuadores] = useState<Tatuador[]>([])

  const cargar = useCallback(async () => {
    const [p, t, tat] = await Promise.all([
      supabase.from('puestos').select('*').order('orden'),
      supabase.from('puesto_titulares').select('*'),
      // Todos los tatuadores: las asignaciones históricas de archivados
      // deben seguir mostrando su nombre
      supabase.from('tatuadores').select('*').order('orden'),
    ])
    setPuestos(p.data ?? [])
    setTitulares(t.data ?? [])
    setTatuadores((tat.data as Tatuador[]) ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { cargar() }, [cargar])

  async function actualizarPuesto(id: string, cambios: Partial<Puesto>) {
    setPuestos(ps => ps.map(p => p.id === id ? { ...p, ...cambios } : p))
    await supabase.from('puestos').update(cambios).eq('id', id)
  }

  async function agregarTitular(puestoId: string, tatuadorId: string) {
    if (!tatuadorId) return
    const { data } = await supabase.from('puesto_titulares')
      .insert({ puesto_id: puestoId, tatuador_id: tatuadorId })
      .select().single()
    if (data) setTitulares(ts => [...ts, data])
  }

  async function quitarTitular(id: string) {
    setTitulares(ts => ts.filter(t => t.id !== id))
    await supabase.from('puesto_titulares').delete().eq('id', id)
  }

  function nombreTat(id: string): string {
    const t = tatuadores.find(x => x.id === id)
    return t ? (t.nombre_artistico || t.nombre) : '?'
  }

  if (loading) return <div className="spinner" />

  return (
    <div>
      <h1 style={{ marginBottom: 6 }}>Puestos</h1>
      <p style={{ color: 'var(--text2)', fontSize: '0.85rem', marginBottom: 20 }}>
        <strong>Full</strong>: 1 titular fijo · <strong>Compartido</strong>: 2 titulares ·{' '}
        <strong>Rotativo</strong>: sin titulares fijos, se reserva día a día desde{' '}
        <a href="/calendario" style={{ textDecoration: 'underline' }}>Calendario</a>. Los puestos no
        gestionados (tatuadores fuera del sistema) se muestran en gris en el panel.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {puestos.map(p => {
          const tits = titulares.filter(t => t.puesto_id === p.id)
          return (
            <div key={p.id} className="card" style={{ opacity: p.activo ? 1 : 0.5 }}>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                <strong style={{ minWidth: 90 }}>{p.nombre}</strong>

                <select
                  value={p.tipo}
                  onChange={e => actualizarPuesto(p.id, { tipo: e.target.value as PuestoTipo })}
                  style={{ width: 130 }}
                >
                  <option value="full">Full</option>
                  <option value="compartido">Compartido</option>
                  <option value="rotativo">Rotativo</option>
                </select>

                <label style={{ display: 'flex', alignItems: 'center', gap: 6, margin: 0, fontSize: '0.85rem', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={p.gestionado}
                    onChange={e => actualizarPuesto(p.id, { gestionado: e.target.checked })}
                    style={{ width: 'auto' }}
                  />
                  En el sistema
                </label>

                <label style={{ display: 'flex', alignItems: 'center', gap: 6, margin: 0, fontSize: '0.85rem', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={p.activo}
                    onChange={e => actualizarPuesto(p.id, { activo: e.target.checked })}
                    style={{ width: 'auto' }}
                  />
                  Activo
                </label>

                {/* Titulares (full / compartido) */}
                {p.tipo !== 'rotativo' && (
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                    {tits.map(t => (
                      <span key={t.id} className="pill">
                        {nombreTat(t.tatuador_id)}{' '}
                        <span
                          onClick={() => quitarTitular(t.id)}
                          style={{ cursor: 'pointer', color: 'var(--rojo)' }}
                        >✕</span>
                      </span>
                    ))}
                    {tits.length < (p.tipo === 'full' ? 1 : 2) && (
                      <select
                        value=""
                        onChange={e => agregarTitular(p.id, e.target.value)}
                        style={{ width: 190 }}
                      >
                        <option value="">+ titular (tipo {p.tipo})…</option>
                        {tatuadores
                          .filter(t => t.activo && !t.archivado && !t.eliminado)
                          .filter(t => (t.tipo_puesto ?? 'rotativo') === p.tipo)
                          .filter(t => !tits.some(x => x.tatuador_id === t.id))
                          .map(t => (
                            <option key={t.id} value={t.id}>{t.nombre_artistico || t.nombre}</option>
                          ))}
                      </select>
                    )}
                  </div>
                )}

                {p.tipo === 'rotativo' && (
                  <span style={{ fontSize: '0.82rem', color: 'var(--text3)' }}>
                    Reservas día a día en <a href="/calendario" style={{ textDecoration: 'underline' }}>Calendario</a>
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function PuestosPageProtegida() {
  return <SoloRoles roles={['admin', 'host']}><PuestosPage /></SoloRoles>
}
