'use client'
import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { Puesto, PuestoTitular, PuestoAsignacion, PuestoTipo, Tatuador } from '@/lib/types'

function hoyISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function PuestosPage() {
  const [loading, setLoading] = useState(true)
  const [puestos, setPuestos] = useState<Puesto[]>([])
  const [titulares, setTitulares] = useState<PuestoTitular[]>([])
  const [tatuadores, setTatuadores] = useState<Tatuador[]>([])
  const [fecha, setFecha] = useState(hoyISO())
  const [asignaciones, setAsignaciones] = useState<PuestoAsignacion[]>([])

  const cargar = useCallback(async () => {
    const [p, t, tat] = await Promise.all([
      supabase.from('puestos').select('*').order('orden'),
      supabase.from('puesto_titulares').select('*'),
      supabase.from('tatuadores').select('*').eq('activo', true).order('orden'),
    ])
    setPuestos(p.data ?? [])
    setTitulares(t.data ?? [])
    setTatuadores(tat.data ?? [])
    setLoading(false)
  }, [])

  const cargarAsignaciones = useCallback(async () => {
    const { data } = await supabase.from('puesto_asignaciones').select('*').eq('fecha', fecha)
    setAsignaciones(data ?? [])
  }, [fecha])

  useEffect(() => { cargar() }, [cargar])
  useEffect(() => { cargarAsignaciones() }, [cargarAsignaciones])

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

  async function asignarDia(puestoId: string, tatuadorId: string) {
    const existente = asignaciones.find(a => a.puesto_id === puestoId)
    if (existente) {
      if (!tatuadorId) {
        setAsignaciones(as => as.filter(a => a.id !== existente.id))
        await supabase.from('puesto_asignaciones').delete().eq('id', existente.id)
        return
      }
      setAsignaciones(as => as.map(a => a.id === existente.id ? { ...a, tatuador_id: tatuadorId } : a))
      await supabase.from('puesto_asignaciones').update({ tatuador_id: tatuadorId }).eq('id', existente.id)
    } else if (tatuadorId) {
      const { data } = await supabase.from('puesto_asignaciones')
        .insert({ puesto_id: puestoId, tatuador_id: tatuadorId, fecha })
        .select().single()
      if (data) setAsignaciones(as => [...as, data])
    }
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
        <strong>Rotativo</strong>: se asigna día a día. Los puestos no gestionados
        (tatuadores fuera del sistema) se muestran en gris en el panel.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {puestos.map(p => {
          const tits = titulares.filter(t => t.puesto_id === p.id)
          const asig = asignaciones.find(a => a.puesto_id === p.id)
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
                        style={{ width: 170 }}
                      >
                        <option value="">+ titular…</option>
                        {tatuadores
                          .filter(t => !tits.some(x => x.tatuador_id === t.id))
                          .map(t => (
                            <option key={t.id} value={t.id}>{t.nombre_artistico || t.nombre}</option>
                          ))}
                      </select>
                    )}
                  </div>
                )}

                {/* Asignación del día (rotativo) */}
                {p.tipo === 'rotativo' && p.gestionado && (
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <input
                      type="date"
                      value={fecha}
                      onChange={e => setFecha(e.target.value)}
                      style={{ width: 150 }}
                    />
                    <select
                      value={asig?.tatuador_id ?? ''}
                      onChange={e => asignarDia(p.id, e.target.value)}
                      style={{ width: 170 }}
                    >
                      <option value="">— sin asignar —</option>
                      {tatuadores.map(t => (
                        <option key={t.id} value={t.id}>{t.nombre_artistico || t.nombre}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
