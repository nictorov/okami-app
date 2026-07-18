'use client'
import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useSesion, Rol } from '@/lib/sesion'

interface TabDef { href: string; label: string; roles: Rol[] }

// Qué ve cada rol:
//  Admin: todo + las 3 vistas de consentimientos (módulos internos)
//  Tatuador: calendario, sus tatuajes, analytics, clientes, reparaciones + su consentimiento
//  Host (recepción): panel, calendario, registro, puestos, reparaciones + consentimiento clientes
const TABS: TabDef[] = [
  { href: '/', label: 'Panel', roles: ['admin', 'host'] },
  { href: '/calendario', label: 'Calendario', roles: ['admin', 'host', 'tatuador'] },
  { href: '/tatuajes', label: 'Registro Tatuajes', roles: ['admin', 'host', 'tatuador'] },
  { href: '/analytics', label: 'Analytics', roles: ['tatuador'] },
  { href: '/clientes', label: 'Clientes', roles: ['admin', 'tatuador'] },
  { href: '/tatuadores', label: 'Tatuadores', roles: ['admin'] },
  { href: '/puestos', label: 'Puestos', roles: ['admin', 'host'] },
  { href: '/reparaciones', label: 'Reparaciones', roles: ['admin', 'host', 'tatuador'] },
  { href: '/stats', label: 'Estadísticas', roles: ['admin'] },
  { href: '/consentimiento/cliente', label: '✍ Consent. Cliente', roles: ['admin', 'host'] },
  { href: '/consentimiento/tatuador', label: '✍ Consent. Tatuador', roles: ['admin', 'tatuador'] },
  { href: '/consentimiento/admin', label: '✍ Consent. Admin', roles: ['admin'] },
]

export default function Nav() {
  const pathname = usePathname()
  const { sesion, salir } = useSesion()
  const [abierto, setAbierto] = useState(false)
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

        {/* Pestañas (escritorio) */}
        <div className="nav-tabs">
          {tabs.map(t => (
            <Link key={t.href} href={t.href}
              className={`tab ${pathname === t.href ? 'activo' : ''}`}>
              {t.label}
            </Link>
          ))}
        </div>

        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap' }}>
          <span className="nav-usuario" style={{ color: 'var(--text3)', fontSize: '0.8rem' }}>{sesion.nombre}</span>
          <button className="chico secundario nav-salir" onClick={salir}>Salir</button>
          {/* Hamburguesa (móvil) */}
          <button
            className="chico secundario nav-burger"
            aria-label={abierto ? 'Cerrar menú' : 'Abrir menú'}
            aria-expanded={abierto}
            onClick={() => setAbierto(!abierto)}
          >
            {abierto ? '✕' : '☰'}
          </button>
        </span>
      </div>

      {/* Menú desplegable (móvil) */}
      {abierto && (
        <div className="nav-movil">
          {tabs.map(t => (
            <Link key={t.href} href={t.href}
              className={`item ${pathname === t.href ? 'activo' : ''}`}
              onClick={() => setAbierto(false)}>
              {t.label}
            </Link>
          ))}
          <button className="item salir" onClick={() => { setAbierto(false); salir() }}>
            Salir ({sesion.nombre})
          </button>
        </div>
      )}
    </nav>
  )
}
