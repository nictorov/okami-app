'use client'
import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useSesion, Rol } from '@/lib/sesion'

interface TabDef { href: string; label: string; roles: Rol[]; grupo?: 'herramientas' }

// Qué ve cada rol:
//  Admin: todo + las 3 vistas de consentimientos (módulos internos)
//  Tatuador: calendario, sus tatuajes, analytics, clientes + herramientas + su consentimiento
//  Host (recepción): panel, calendario, registro, puestos + herramientas + consentimiento clientes
const TABS: TabDef[] = [
  { href: '/', label: 'Panel', roles: ['admin', 'host'] },
  { href: '/calendario', label: 'Calendario', roles: ['admin', 'host', 'tatuador'] },
  { href: '/tatuajes', label: 'Registro Tatuajes', roles: ['admin', 'host', 'tatuador'] },
  { href: '/analytics', label: 'Analytics', roles: ['admin', 'tatuador'] },
  { href: '/clientes', label: 'Clientes', roles: ['admin', 'tatuador'] },
  { href: '/tatuadores', label: 'Tatuadores', roles: ['admin', 'host'] },
  { href: '/puestos', label: 'Puestos', roles: ['admin'] },
  { href: '/consentimiento/cliente', label: '✍ Consent. Cliente', roles: ['admin', 'host'] },
  { href: '/consentimiento/tatuador', label: '✍ Consent. Tatuador', roles: ['admin', 'tatuador'] },
  { href: '/consentimiento/admin', label: '✍ Consent. Admin', roles: ['admin'] },
  // Herramientas y ayuda
  { href: '/print', label: 'Tattoo Print Tool', roles: ['admin', 'host', 'tatuador'], grupo: 'herramientas' },
  { href: '/reparaciones', label: 'Reparaciones', roles: ['admin', 'host', 'tatuador'], grupo: 'herramientas' },
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

  const principales = tabs.filter(t => t.grupo !== 'herramientas')
  const herramientas = tabs.filter(t => t.grupo === 'herramientas')

  return (
    <nav className="nav">
      <div className="nav-inner">
        <div className="nav-logo">
          <img src="/isotipo-black.png" alt="" />
          Okami <span>APP</span>
        </div>

        {/* Pestañas (escritorio) */}
        <div className="nav-tabs">
          {principales.map(t => (
            <Link key={t.href} href={t.href}
              className={`tab ${pathname === t.href ? 'activo' : ''}`}>
              {t.label}
            </Link>
          ))}
          {herramientas.length > 0 && <span className="nav-sep" aria-hidden />}
          {herramientas.map(t => (
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
          {principales.map(t => (
            <Link key={t.href} href={t.href}
              className={`item ${pathname === t.href ? 'activo' : ''}`}
              onClick={() => setAbierto(false)}>
              {t.label}
            </Link>
          ))}
          {herramientas.length > 0 && <div className="seccion">Herramientas y ayuda</div>}
          {herramientas.map(t => (
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
