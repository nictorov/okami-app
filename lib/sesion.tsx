'use client'
import { createContext, useContext } from 'react'

export type Rol = 'admin' | 'host' | 'tatuador'

export interface Sesion {
  rol: Rol
  tatuadorId?: string   // solo cuando rol === 'tatuador'
  nombre?: string
}

export const SesionContext = createContext<{ sesion: Sesion | null; salir: () => void }>({
  sesion: null,
  salir: () => {},
})

export function useSesion() {
  return useContext(SesionContext)
}
