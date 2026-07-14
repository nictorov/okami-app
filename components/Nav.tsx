'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useSesion, Rol } from '@/lib/sesion'

interface TabDef { href: string; label: string; roles: Rol[] }

// Qué ve cada rol:
//  Admin: todo + las 3 vistas de consentimientos (ahora módulos internos)
//  Tatuador: sus cotizaciones, sus atenciones, sus clientes + su consentimiento
//  Host (recepción): panel, cotizaciones, atenciones (solo nombres), puestos + consentimiento clientes
const TABS: TabDef[] = [
  { href: '/', label: 'Panel', roles: ['admin', 'host'] },
  { href: '/calendario', label: 'Calendario', roles: ['admin', 'host', 'tatuador'] },
  { href: '/tatuajes', label: 'Registro Tatuajes', roles: ['admin', 'host', 'tatuador'] },
  { href: '/clientes', label: 'Clientes', roles: ['admin', 'tatuador'] },
  { href: '/tatuadores', label: 'Tatuadores', roles: ['admin'] },
  { href: '/puestos', label: 'Puestos', roles: ['admin', 'host'] },
  { href: '/stats', label: 'Estadísticas', roles: ['admin'] },
  { href: '/consentimiento/cliente', label: '✍ Consent. Cliente', roles: ['admin', 'host'] },
  { href: '/consentimiento/tatuador', label: '✍ Consent. Tatuador', roles: ['admin', 'tatuador'] },
  { href: '/consentimiento/admin', label: '✍ Consent. Admin', roles: ['admin'] },
]

export default function Nav() {
  const pathname = usePathname()
  const { sesion, salir } = useSesion()
  if (!sesion) return null

  // La sección de tatuajes cambia de nombre según el rol
  const tabs = TABS
    .filter(t => t.roles.includes(sesion.rol))
    .map(t => t.href === '/tatuajes' && sesion.rol === 'tatuador'
      ? { ...t, label: 'Mis tatuajes' }
      : t)

  return (
    <nav className="nav">
      <div className="nav-inner">
        <div className="nav-logo">Okami <span>APP</span></div>
        {tabs.map(t => (
          <Link key={t.href} href={t.href}
            className={`tab ${pathname === t.href ? 'activo' : ''}`}>
            {t.label}
          </Link>
        ))}
        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap' }}>
          <span style={{ color: 'var(--text3)', fontSize: '0.8rem' }}>{sesion.nombre}</span>
          <button className="chico secundario" onClick={salir}>Salir</button>
        </span>
      </div>
    </nav>
  )
}
