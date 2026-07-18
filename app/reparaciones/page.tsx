'use client'
// Reparaciones: tickets del estudio (lámparas, camillas, etc.)
//  * Tatuador: ingresa solicitudes de texto y ve las suyas.
//  * Admin/Recepción: responden (→ respondida) y cierran (resuelta /
//    cancelada).
import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { Tatuador } from '@/lib/types'
import { useSesion } from '@/lib/sesion'

interface Reparacion {
  id: string
  tatuador_id: string
  solicitud: string
  respuesta: string | null
  respondida_por: string | null
  estado: 'enviada' | 'respondida' | 'resuelta' | 'cancelada'
  created_at: string
  updated_at: string
}

const ESTADO_LABEL: Record<Reparacion['estado'], string> = {
  enviada: 'Enviada', respondida: 'Respondida', resuelta: 'Resuelta', cancelada: 'Cancelada',
}
const ESTADO_PILL: Record<Reparacion['estado'], string> = {
  enviada: 'alerta', respondida: '', resuelta: 'ok', cancelada: 'peligro',
}

export default function ReparacionesPage() {
  const { sesion } = useSesion()
  const esTatuador = sesion?.rol === 'tatuador'
  const rol = sesion?.rol ?? 'admin'
  const miId = sesion?.tatuadorId ?? null

  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'activas' | 'cerradas'>('activas')
  const [tickets, setTickets] = useState<Reparacion[]>([])
  const [tatuadores, setTatuadores] = useState<Tatuador[]>([])
  const [nueva, setNueva] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [respondiendo, setRespondiendo] = useState<string | null>(null)
  const [respuesta, setRespuesta] = useState('')

  const cargar = useCallback(async () => {
    setLoading(true)
    let q = supabase.from('reparaciones').select('*')
      .order('created_at', { ascending: false }).limit(200)
    q = tab === 'activas'
      ? q.in('estado', ['enviada', 'respondida'])
      : q.in('estado', ['resuelta', 'cancelada'])
    if (esTatuador && miId) q = q.eq('tatuador_id', miId)
    const [r, t] = await Promise.all([
      q,
      supabase.from('tatuadores').select('*'),
    ])
    setTickets((r.data as Reparacion[]) ?? [])
    setTatuadores((t.data as Tatuador[]) ?? [])
    setLoading(false)
  }, [tab, esTatuador, miId])

  useEffect(() => { cargar() }, [cargar])

  function nombreTat(id: string): string {
    const t = tatuadores.find(x => x.id === id)
    return t ? (t.nombre_artistico || t.nombre) : '?'
  }

  async function enviar() {
    if (!nueva.trim()) { alert('Describe qué necesita reparación.'); return }
    if (!miId) return
    setEnviando(true)
    const { error } = await supabase.from('reparaciones').insert({
      tatuador_id: miId,
      solicitud: nueva.trim(),
    })
    setEnviando(false)
    if (error) { alert('Error al enviar: ' + error.message); return }
    setNueva('')
    setTab('activas')
    cargar()
  }

  async function actualizar(id: string, cambios: Partial<Reparacion>) {
    await supabase.from('reparaciones')
      .update({ ...cambios, updated_at: new Date().toISOString() }).eq('id', id)
    cargar()
  }

  async function responder(t: Reparacion) {
    if (!respuesta.trim()) { alert('Escribe la respuesta.'); return }
    await actualizar(t.id, {
      respuesta: respuesta.trim(),
      respondida_por: rol,
      estado: 'respondida',
    })
    setRespondiendo(null)
    setRespuesta('')
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 18 }}>
        <h1>Reparaciones</h1>
        <button className={`chico ${tab === 'activas' ? '' : 'secundario'}`} onClick={() => setTab('activas')}>Activas</button>
        <button className={`chico ${tab === 'cerradas' ? '' : 'secundario'}`} onClick={() => setTab('cerradas')}>Cerradas</button>
      </div>

      {/* Nueva solicitud (tatuador) */}
      {esTatuador && (
        <div className="card" style={{ marginBottom: 18 }}>
          <div className="section-title">Nueva solicitud</div>
          <textarea rows={2} value={nueva}
            placeholder="Ej: la lámpara del puesto 4 quedó parpadeando"
            onChange={e => setNueva(e.target.value)} />
          <button style={{ marginTop: 10 }} onClick={enviar} disabled={enviando}>
            {enviando ? 'Enviando…' : 'Enviar solicitud'}
          </button>
        </div>
      )}

      {loading ? <div className="spinner" /> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {tickets.map(t => (
            <div key={t.id} className="card" style={{ padding: 14 }}>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 6 }}>
                <span className={`pill ${ESTADO_PILL[t.estado]}`}>{ESTADO_LABEL[t.estado]}</span>
                {!esTatuador && <strong>{nombreTat(t.tatuador_id)}</strong>}
                <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text3)' }}>
                  {new Date(t.created_at).toLocaleDateString('es-CL', { day: '2-digit', month: 'short' })}
                  {' '}{new Date(t.created_at).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>

              <p style={{ fontSize: 14, marginBottom: t.respuesta || !esTatuador ? 8 : 0 }}>{t.solicitud}</p>

              {t.respuesta && (
                <div style={{ background: 'var(--bg2)', borderRadius: 8, padding: '10px 12px', fontSize: 13, marginBottom: 8 }}>
                  <span style={{ color: 'var(--text3)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Respuesta {t.respondida_por === 'host' ? 'de recepción' : t.respondida_por === 'admin' ? 'del admin' : ''}
                  </span>
                  <div>{t.respuesta}</div>
                </div>
              )}

              {/* Acciones admin / recepción */}
              {!esTatuador && ['enviada', 'respondida'].includes(t.estado) && (
                respondiendo === t.id ? (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                    <textarea rows={2} value={respuesta} placeholder="Escribe la respuesta…"
                      onChange={e => setRespuesta(e.target.value)} style={{ flex: 1, minWidth: 220 }} />
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className="chico" onClick={() => responder(t)}>Responder</button>
                      <button className="chico secundario" onClick={() => setRespondiendo(null)}>✕</button>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button className="chico" onClick={() => { setRespondiendo(t.id); setRespuesta(t.respuesta ?? '') }}>
                      {t.respuesta ? 'Editar respuesta' : 'Responder'}
                    </button>
                    <button className="chico secundario" onClick={() => actualizar(t.id, { estado: 'resuelta' })}>
                      ✓ Marcar resuelta
                    </button>
                    <button className="chico secundario" onClick={() => {
                      if (confirm('¿Cancelar esta solicitud?')) actualizar(t.id, { estado: 'cancelada' })
                    }}>Cancelar</button>
                  </div>
                )
              )}
            </div>
          ))}
          {tickets.length === 0 && (
            <div className="vacio">
              {tab === 'activas' ? 'Sin solicitudes activas.' : 'Sin solicitudes cerradas.'}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
