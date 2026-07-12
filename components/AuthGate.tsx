'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Sesion, SesionContext, Rol } from '@/lib/sesion'

// Acceso por rol:
//   Admin → NEXT_PUBLIC_APP_PIN · Host → NEXT_PUBLIC_HOST_PIN
//   Tatuador → su PIN personal (tatuadores.pin, editable en /admin de consentimientos)
// NOTA: protección a nivel de interfaz, consistente con el resto del proyecto.
// Pendiente migrar a Supabase Auth con usuarios reales.
const STORAGE_KEY = 'okami_app_sesion'

interface TatuadorMin { id: string; nombre: string; nombre_artistico: string | null; pin: string | null }

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const [sesion, setSesion] = useState<Sesion | null>(null)
  const [listo, setListo] = useState(false)
  const [modo, setModo] = useState<Rol>('admin')
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [tatuadores, setTatuadores] = useState<TatuadorMin[]>([])
  const [tatuadorSel, setTatuadorSel] = useState('')

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) setSesion(JSON.parse(raw))
    } catch { /* sesión corrupta: pedir login */ }
    setListo(true)
  }, [])

  useEffect(() => {
    if (modo !== 'tatuador' || tatuadores.length > 0) return
    supabase.from('tatuadores')
      .select('id, nombre, nombre_artistico, pin')
      .eq('activo', true)
      .order('orden')
      .then(({ data }) => setTatuadores((data ?? []).filter((t: TatuadorMin & { archivado?: boolean; eliminado?: boolean }) =>
        !(t as { archivado?: boolean }).archivado && !(t as { eliminado?: boolean }).eliminado)))
  }, [modo, tatuadores.length])

  function guardar(s: Sesion) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
    setSesion(s)
    setPin(''); setError('')
  }

  function entrar(e: React.FormEvent) {
    e.preventDefault()
    if (modo === 'admin') {
      if (pin === (process.env.NEXT_PUBLIC_APP_PIN || '0000')) {
        guardar({ rol: 'admin', nombre: 'Admin' })
      } else setError('PIN incorrecto')
    } else if (modo === 'host') {
      if (pin === (process.env.NEXT_PUBLIC_HOST_PIN || '1111')) {
        guardar({ rol: 'host', nombre: 'Recepción' })
      } else setError('PIN incorrecto')
    } else {
      const t = tatuadores.find(x => x.id === tatuadorSel)
      if (!t) { setError('Elige tu nombre'); return }
      if (!t.pin) { setError('No tienes PIN configurado. Pide al admin que te asigne uno.'); return }
      if (pin === t.pin) {
        guardar({ rol: 'tatuador', tatuadorId: t.id, nombre: t.nombre_artistico || t.nombre })
      } else setError('PIN incorrecto')
    }
    setPin('')
  }

  function salir() {
    localStorage.removeItem(STORAGE_KEY)
    setSesion(null)
  }

  if (!listo) return null

  if (sesion) {
    return <SesionContext.Provider value={{ sesion, salir }}>{children}</SesionContext.Provider>
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <form onSubmit={entrar} className="card" style={{ width: 340, textAlign: 'center' }}>
        <h1 style={{ marginBottom: 6 }}>Okami <span style={{ color: 'var(--accent)' }}>APP</span></h1>
        <p style={{ color: 'var(--text2)', fontSize: '0.85rem', marginBottom: 16 }}>Gestión del estudio</p>

        <div style={{ display: 'flex', gap: 6, justifyContent: 'center', marginBottom: 16 }}>
          {(['admin', 'host', 'tatuador'] as Rol[]).map(r => (
            <button key={r} type="button"
              className={`chico ${modo === r ? '' : 'secundario'}`}
              onClick={() => { setModo(r); setError(''); setPin('') }}>
              {r === 'admin' ? 'Admin' : r === 'host' ? 'Recepción' : 'Tatuador'}
            </button>
          ))}
        </div>

        {modo === 'tatuador' && (
          <select value={tatuadorSel} onChange={e => { setTatuadorSel(e.target.value); setError('') }}
            style={{ marginBottom: 12 }}>
            <option value="">— ¿Quién eres? —</option>
            {tatuadores.map(t => (
              <option key={t.id} value={t.id}>{t.nombre_artistico || t.nombre}</option>
            ))}
          </select>
        )}

        <input
          type="password"
          inputMode="numeric"
          placeholder="PIN"
          value={pin}
          autoFocus
          onChange={e => { setPin(e.target.value); setError('') }}
          style={{ textAlign: 'center', marginBottom: 12 }}
        />
        {error && <p style={{ color: 'var(--rojo)', fontSize: '0.8rem', marginBottom: 12 }}>{error}</p>}
        <button type="submit" style={{ width: '100%' }}>Entrar</button>
      </form>
    </div>
  )
}
