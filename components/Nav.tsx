'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useSesion, CONSENT_URL, Rol } from '@/lib/sesion'

interface TabDef { href: string; label: string; roles: Rol[]; externo?: boolean }

// Qué ve cada rol:
//  Admin: todo + links a las 3 vistas de consentimientos
//  Tatuador: sus cotizaciones, sus atenciones, sus clientes + link consentimiento tatuador
//  Host (recepción): panel, cotizaciones, atenciones (solo nombres), puestos + consentimiento clientes
const TABS: TabDef[] = [
  { href: '/', label: 'Panel', roles: ['admin', 'host'] },
  { href: '/cotizaciones', label: 'Cotizaciones', roles: ['admin', 'host', 'tatuador'] },
  { href: '/atenciones', label: 'Atenciones', roles: ['admin', 'host', 'tatuador'] },
  { href: '/clientes', label: 'Clientes', roles: ['admin', 'tatuador'] },
  { href: '/tatuadores', label: 'Tatuadores', roles: ['admin'] },
  { href: '/puestos', label: 'Puestos', roles: ['admin', 'host'] },
  { href: '/stats', label: 'Estadísticas', roles: ['admin'] },
  { href: `${CONSENT_URL}/cliente`, label: '✍ Consent. Cliente', roles: ['admin', 'host'], externo: true },
  { href: `${CONSENT_URL}/tatuador`, label: '✍ Consent. Tatuador', roles: ['admin', 'tatuador'], externo: true },
  { href: `${CONSENT_URL}/admin`, label: '✍ Consent. Admin', roles: ['admin'], externo: true },
]

export default function Nav() {
  const pathname = usePathname()
  const { sesion, salir } = useSesion()
  if (!sesion) return null

  const tabs = TABS.filter(t => t.roles.includes(sesion.rol))

  return (
    <nav className="nav">
      <div className="nav-inner">
        <div className="nav-logo">Okami <span>APP</span></div>
        {tabs.map(t => t.externo ? (
          <a key={t.href} href={t.href} target="_blank" rel="noreferrer" className="tab">
            {t.label}
          </a>
        ) : (
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
