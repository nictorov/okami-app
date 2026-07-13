'use client'
// Campos de monto en pesos chilenos: solo dígitos, autoformato $###.###
// sin decimales. "150.000", "150000" y "$150.000" se interpretan igual
// (el punto NO es decimal en CLP).
import { useState } from 'react'

function soloDigitos(s: string): string {
  return s.replace(/\D/g, '')
}

function formatearMiles(digitos: string): string {
  return digitos ? Number(digitos).toLocaleString('es-CL') : ''
}

// Controlado por string de dígitos (ej. "150000"); muestra "150.000".
export function MoneyInput({ value, onChange, placeholder, style }: {
  value: string
  onChange: (digitos: string) => void
  placeholder?: string
  style?: React.CSSProperties
}) {
  const digitos = soloDigitos(value)
  return (
    <input
      inputMode="numeric"
      value={formatearMiles(digitos)}
      placeholder={placeholder}
      style={style}
      onChange={e => onChange(soloDigitos(e.target.value))}
    />
  )
}

// Celda editable: parte de un número, formatea mientras se escribe y
// confirma al salir del campo (onBlur) solo si cambió.
export function MoneyCell({ initial, onCommit, style }: {
  initial: number
  onCommit: (n: number) => void
  style?: React.CSSProperties
}) {
  const [v, setV] = useState(initial ? String(initial) : '')
  const digitos = soloDigitos(v)
  return (
    <input
      inputMode="numeric"
      value={formatearMiles(digitos)}
      style={style ?? { width: 100, padding: '3px 6px' }}
      onChange={e => setV(soloDigitos(e.target.value))}
      onBlur={() => {
        const n = digitos ? Number(digitos) : 0
        if (n !== initial) onCommit(n)
      }}
    />
  )
}
