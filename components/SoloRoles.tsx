'use client'
import { useSesion, Rol } from '@/lib/sesion'

export default function SoloRoles({ roles, children }: { roles: Rol[]; children: React.ReactNode }) {
  const { sesion } = useSesion()
  if (!sesion || !roles.includes(sesion.rol)) {
    return <div className="vacio">No tienes acceso a esta sección.</div>
  }
  return <>{children}</>
}
