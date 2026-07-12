'use client'
// Componentes y utilidades compartidas de los módulos de consentimiento
// (copiados de okami-consentimientos y adaptados a esta APP)
import { useEffect, useRef, useState } from 'react'

export interface TatuadorItem {
  nombre: string
  nombre_artistico?: string | null
}

export function formatRutC(raw: string): string {
  const clean = raw.replace(/[^0-9kK]/g, '').toUpperCase()
  if (clean.length === 0) return ''
  const dv = clean.slice(-1), body = clean.slice(0, -1)
  if (body.length === 0) return dv
  return body.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + '-' + dv
}

export function calcEdad(nacimiento: string): number | null {
  if (!nacimiento) return null
  const hoy = new Date(), nac = new Date(nacimiento)
  let edad = hoy.getFullYear() - nac.getFullYear()
  const m = hoy.getMonth() - nac.getMonth()
  if (m < 0 || (m === 0 && hoy.getDate() < nac.getDate())) edad--
  return edad
}

export function telefonoCompleto(prefijo: string, num: string): string {
  const p = prefijo.trim(), n = num.trim()
  if (!n) return ''
  return `${p} ${n}`
}

export function splitTelefono(tel?: string | null): { prefijo: string; num: string } {
  if (!tel) return { prefijo: '+569', num: '' }
  const parts = tel.trim().split(' ')
  if (parts.length >= 2) return { prefijo: parts[0], num: parts.slice(1).join('') }
  return { prefijo: '+569', num: tel }
}

// "Francesca "Nocturna_tattoo""
export function displayTatuador(t: TatuadorItem): string {
  const primerNombre = t.nombre.split(' ')[0]
  if (t.nombre_artistico) return `${primerNombre} "${t.nombre_artistico}"`
  return t.nombre
}

export function RutInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input type="text" value={value}
      onChange={e => onChange(formatRutC(e.target.value))}
      placeholder="Ej: 12.345.678-9" maxLength={12} />
  )
}

export function TelefonoInput({ prefijo, num, onPrefijo, onNum }: {
  prefijo: string; num: string; onPrefijo: (v: string) => void; onNum: (v: string) => void
}) {
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      <input type="text" value={prefijo} onChange={e => onPrefijo(e.target.value)}
        style={{ width: 72, flexShrink: 0 }} maxLength={6} />
      <input type="tel" value={num}
        onChange={e => onNum(e.target.value.replace(/\D/g, '').slice(0, 8))}
        placeholder="12345678" style={{ flex: 1 }} />
    </div>
  )
}

// Buscador de tatuador: por nombre real y nombre artístico
export function TatuadorSearch({ tatuadores, value, onChange, conOtro = true }: {
  tatuadores: TatuadorItem[]
  value: string
  onChange: (nombre: string) => void
  conOtro?: boolean
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)

  const selected = value === 'Otro'
    ? 'Otro (tatuador invitado)'
    : tatuadores.find(t => t.nombre === value)
  const inputValue = selected && typeof selected === 'object'
    ? displayTatuador(selected)
    : selected === 'Otro (tatuador invitado)' ? 'Otro (tatuador invitado)'
    : query

  const filtered = query.trim() === ''
    ? tatuadores
    : tatuadores.filter(t => {
        const q = query.toLowerCase()
        return t.nombre.toLowerCase().includes(q) ||
          (t.nombre_artistico ?? '').toLowerCase().includes(q)
      })

  const select = (nombre: string) => { onChange(nombre); setQuery(''); setOpen(false) }

  return (
    <div style={{ position: 'relative' }}>
      <input
        type="text"
        value={value ? inputValue : query}
        onChange={e => { setQuery(e.target.value); onChange(''); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Busca por nombre o nombre artístico..."
        autoComplete="off"
      />
      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50,
          background: 'var(--bg)', border: '0.5px solid var(--border)',
          borderRadius: 'var(--radius)', maxHeight: 240, overflowY: 'auto',
          boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
        }}>
          {filtered.length === 0 && (
            <div style={{ padding: '10px 14px', fontSize: 13, color: 'var(--text2)' }}>Sin resultados</div>
          )}
          {filtered.map(t => (
            <div key={t.nombre} onMouseDown={() => select(t.nombre)}
              style={{ padding: '10px 14px', cursor: 'pointer', fontSize: 13,
                borderBottom: '0.5px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 1 }}>
              <span style={{ fontWeight: 500 }}>{displayTatuador(t)}</span>
              {t.nombre_artistico && <span style={{ fontSize: 11, color: 'var(--text2)' }}>{t.nombre}</span>}
            </div>
          ))}
          {conOtro && (
            <div onMouseDown={() => select('Otro')}
              style={{ padding: '10px 14px', cursor: 'pointer', fontSize: 13,
                color: 'var(--text2)', fontStyle: 'italic' }}>
              Otro (tatuador invitado)
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// Modal imprimir y firmar con countdown
export function ModalImprimirFirmar({ folio, onAceptar, onCancelar }: {
  folio: string
  onAceptar: () => void
  onCancelar: () => void
}) {
  const [secs, setSecs] = useState(3)
  const [ready, setReady] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    intervalRef.current = setInterval(() => {
      setSecs(s => {
        if (s <= 1) {
          clearInterval(intervalRef.current!)
          setReady(true)
          return 0
        }
        return s - 1
      })
    }, 1000)
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [])

  return (
    <div className="modal-overlay">
      <div className="modal-box">
        <div className="modal-title">Imprimir y firmar</div>
        <div className="modal-folio">{folio}</div>
        <p style={{ fontSize: 13, color: 'var(--text2)', margin: '10px 0 20px', lineHeight: 1.6 }}>
          Imprime el consentimiento y <strong style={{ color: 'var(--text)' }}>FÍRMALO CON TU CLIENTE INMEDIATAMENTE.</strong>{' '}
          Esto da consentimiento al tatuaje protegiéndote a ti y al estudio legalmente.
        </p>
        <div className="btn-row">
          <button className="btn outline" onClick={onCancelar}>Cancelar</button>
          <button className="btn" disabled={!ready} onClick={onAceptar}
            style={{ opacity: ready ? 1 : 0.4, transition: 'opacity 0.3s' }}>
            {ready ? 'Aceptar e imprimir' : `Disponible en ${secs}s...`}
          </button>
        </div>
      </div>
    </div>
  )
}
