'use client'
import { useEffect, useState } from 'react'

// Puerta de acceso simple con PIN (NEXT_PUBLIC_APP_PIN).
// NOTA: protección a nivel de interfaz, consistente con el resto del
// proyecto que usa la anon key pública. Pendiente migrar a Supabase Auth
// con usuarios reales en una fase posterior.
const STORAGE_KEY = 'okami_app_auth'

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const [ok, setOk] = useState<boolean | null>(null)
  const [pin, setPin] = useState('')
  const [error, setError] = useState(false)

  useEffect(() => {
    setOk(localStorage.getItem(STORAGE_KEY) === 'ok')
  }, [])

  function entrar(e: React.FormEvent) {
    e.preventDefault()
    if (pin === (process.env.NEXT_PUBLIC_APP_PIN || '0000')) {
      localStorage.setItem(STORAGE_KEY, 'ok')
      setOk(true)
    } else {
      setError(true)
      setPin('')
    }
  }

  if (ok === null) return null
  if (ok) return <>{children}</>

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <form onSubmit={entrar} className="card" style={{ width: 320, textAlign: 'center' }}>
        <h1 style={{ marginBottom: 6 }}>Okami <span style={{ color: 'var(--accent)' }}>APP</span></h1>
        <p style={{ color: 'var(--text2)', fontSize: '0.85rem', marginBottom: 18 }}>
          Gestión del estudio
        </p>
        <input
          type="password"
          inputMode="numeric"
          placeholder="PIN de acceso"
          value={pin}
          autoFocus
          onChange={e => { setPin(e.target.value); setError(false) }}
          style={{ textAlign: 'center', marginBottom: 12 }}
        />
        {error && (
          <p style={{ color: 'var(--rojo)', fontSize: '0.8rem', marginBottom: 12 }}>PIN incorrecto</p>
        )}
        <button type="submit" style={{ width: '100%' }}>Entrar</button>
      </form>
    </div>
  )
}
