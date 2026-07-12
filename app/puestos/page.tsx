'use client'
import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { Puesto, PuestoTitular, PuestoAsignacion, PuestoTipo, Tatuador } from '@/lib/types'
import SoloRoles from '@/components/SoloRoles'

function hoyISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function esFinDeSemana(fechaISO: string): boolean {
  const dia = new Date(`${fechaISO}T12:00:00`).getDay()
  return dia === 0 || dia === 6
}

function PuestosPage() {
  const [loading, setLoading] = useState(true)
  const [puestos, setPuestos] = useState<Puesto[]>([])
  const [titulares, setTitulares] = useState<PuestoTitular[]>([])
  const [tatuadores, setTatuadores] = useState<Tatuador[]>([])
  const [fecha, setFecha] = useState(hoyISO())
  const [asignaciones, setAsignaciones] = useState<PuestoAsignacion[]>([])
  // Selector rotativo expandido: '__plantel' o '__guest' por (puesto:bloque)
  const [modoSel, setModoSel] = useState<Record<string, 'plantel' | 'guest' | null>>({})
  const [guestForm, setGuestForm] = useState({ key: null as string | null, nombre: '', artistico: '', telefono: '' })

  const cargar = useCallback(async () => {
    const [p, t, tat] = await Promise.all([
      supabase.from('puestos').select('*').order('orden'),
      supabase.from('puesto_titulares').select('*'),
      supabase.from('tatuadores').select('*').eq('activo', true).order('orden'),
    ])
    setPuestos(p.data ?? [])
    setTitulares(t.data ?? [])
    setTatuadores((tat.data ?? []).filter((x: Tatuador) => !x.archivado && !x.eliminado))
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

  async function asignarDia(puestoId: string, tatuadorId: string, bloque: 'dia' | 'am' | 'pm') {
    const existente = asignaciones.find(a => a.puesto_id === puestoId && a.bloque === bloque)
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
        .insert({ puesto_id: puestoId, tatuador_id: tatuadorId, fecha, bloque })
        .select().single()
      if (data) setAsignaciones(as => [...as, data])
    }
  }

  function nombreTat(id: string): string {
    const t = tatuadores.find(x => x.id === id)
    return t ? (t.nombre_artistico || t.nombre) : '?'
  }

  async function crearGuest(puestoId: string, bloque: 'dia' | 'am' | 'pm') {
    if (!guestForm.nombre.trim()) { alert('El nombre es obligatorio'); return }
    const { data, error } = await supabase.from('tatuadores').insert({
      nombre: guestForm.nombre.trim(),
      nombre_artistico: guestForm.artistico.trim() || null,
      telefono: guestForm.telefono.trim() || null,
      tipo_puesto: 'guest',
      en_sistema: true,
      activo: true,
      orden: 999,
    }).select().single()
    if (error) { alert('Error al crear guest: ' + error.message); return }
    setTatuadores(ts => [...ts, data])
    await asignarDia(puestoId, data.id, bloque)
    setGuestForm({ key: null, nombre: '', artistico: '', telefono: '' })
    setModoSel(m => ({ ...m, [`${puestoId}:${bloque}`]: null }))
  }

  // Selector para puestos rotativos: rotativos directo, o expandir
  // "Plantel" (full/compartido) o "Guest" (con alta de guest nuevo)
  function renderSelectorRotativo(p: Puesto, bloque: 'dia' | 'am' | 'pm') {
    const key = `${p.id}:${bloque}`
    const asig = asignaciones.find(a => a.puesto_id === p.id && a.bloque === bloque)
    const modo = modoSel[key] ?? null
    const rotativos = tatuadores.filter(t => (t.tipo_puesto ?? 'rotativo') === 'rotativo')
    const plantel = tatuadores.filter(t => ['full', 'compartido'].includes(t.tipo_puesto ?? 'rotativo'))
    const guests = tatuadores.filter(t => t.tipo_puesto === 'guest')
    const asignado = asig ? tatuadores.find(t => t.id === asig.tatuador_id) : null
    const asignadoFueraDeLista = asignado && !rotativos.some(t => t.id === asignado.id)

    return (
      <span style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <select
          value={modo ? `__${modo}` : (asig?.tatuador_id ?? '')}
          onChange={e => {
            const v = e.target.value
            if (v === '__plantel' || v === '__guest') {
              setModoSel(m => ({ ...m, [key]: v === '__plantel' ? 'plantel' : 'guest' }))
              return
            }
            setModoSel(m => ({ ...m, [key]: null }))
            setGuestForm(g => g.key === key ? { key: null, nombre: '', artistico: '', telefono: '' } : g)
            asignarDia(p.id, v, bloque)
          }}
          style={{ width: 190 }}
        >
          <option value="">— sin asignar —</option>
          {asignadoFueraDeLista && (
            <option value={asignado!.id}>
              {(asignado!.nombre_artistico || asignado!.nombre)} ({asignado!.tipo_puesto})
            </option>
          )}
          {rotativos.map(t => (
            <option key={t.id} value={t.id}>{t.nombre_artistico || t.nombre}</option>
          ))}
          <option value="__plantel">★ Plantel (full / compartido)…</option>
          <option value="__guest">★ Guest…</option>
        </select>

        {modo === 'plantel' && (
          <select
            value=""
            onChange={e => {
              if (!e.target.value) return
              asignarDia(p.id, e.target.value, bloque)
              setModoSel(m => ({ ...m, [key]: null }))
            }}
            style={{ width: 180, borderColor: 'var(--accent)' }}
          >
            <option value="">Elegir del plantel…</option>
            {plantel.map(t => (
              <option key={t.id} value={t.id}>
                {(t.nombre_artistico || t.nombre)} ({t.tipo_puesto})
              </option>
            ))}
          </select>
        )}

        {modo === 'guest' && guestForm.key !== key && (
          <select
            value=""
            onChange={e => {
              const v = e.target.value
              if (v === '__nuevo') {
                setGuestForm({ key, nombre: '', artistico: '', telefono: '' })
                return
              }
              if (!v) return
              asignarDia(p.id, v, bloque)
              setModoSel(m => ({ ...m, [key]: null }))
            }}
            style={{ width: 180, borderColor: 'var(--accent)' }}
          >
            <option value="">Elegir guest…</option>
            {guests.map(t => (
              <option key={t.id} value={t.id}>{t.nombre_artistico || t.nombre}</option>
            ))}
            <option value="__nuevo">+ Nuevo guest</option>
          </select>
        )}

        {guestForm.key === key && (
          <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <input placeholder="Nombre *" value={guestForm.nombre}
              onChange={e => setGuestForm({ ...guestForm, nombre: e.target.value })} style={{ width: 150 }} />
            <input placeholder="Nombre artístico" value={guestForm.artistico}
              onChange={e => setGuestForm({ ...guestForm, artistico: e.target.value })} style={{ width: 150 }} />
            <input placeholder="Teléfono" value={guestForm.telefono}
              onChange={e => setGuestForm({ ...guestForm, telefono: e.target.value })} style={{ width: 130 }} />
            <button className="chico" onClick={() => crearGuest(p.id, bloque)}>Guardar guest</button>
            <button className="chico secundario"
              onClick={() => setGuestForm({ key: null, nombre: '', artistico: '', telefono: '' })}>✕</button>
          </span>
        )}
      </span>
    )
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
                          .filter(t => (t.tipo_puesto ?? 'rotativo') === p.tipo)
                          .filter(t => !tits.some(x => x.tatuador_id === t.id))
                          .map(t => (
                            <option key={t.id} value={t.id}>{t.nombre_artistico || t.nombre}</option>
                          ))}
                      </select>
                    )}
                  </div>
                )}

                {/* Asignación del día (rotativo).
                    Lun–Vie: 1 persona por día. Sáb–Dom: turnos AM (9:00–15:30)
                    y PM (16:00–23:00); la misma persona en ambos = día completo. */}
                {p.tipo === 'rotativo' && p.gestionado && (
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                    <input
                      type="date"
                      value={fecha}
                      onChange={e => setFecha(e.target.value)}
                      style={{ width: 150 }}
                    />
                    {esFinDeSemana(fecha) ? (
                      <>
                        {(['am', 'pm'] as const).map(b => (
                          <div key={b} style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                            <span className="pill">{b === 'am' ? 'AM 9:00–15:30' : 'PM 16:00–23:00'}</span>
                            {renderSelectorRotativo(p, b)}
                          </div>
                        ))}
                      </>
                    ) : (
                      renderSelectorRotativo(p, 'dia')
                    )}
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

export default function PuestosPageProtegida() {
  return <SoloRoles roles={['admin', 'host']}><PuestosPage /></SoloRoles>
}
