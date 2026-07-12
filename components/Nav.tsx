'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const TABS = [
  { href: '/', label: 'Panel' },
  { href: '/cotizaciones', label: 'Cotizaciones' },
  { href: '/atenciones', label: 'Atenciones' },
  { href: '/clientes', label: 'Clientes' },
  { href: '/tatuadores', label: 'Tatuadores' },
  { href: '/puestos', label: 'Puestos' },
  { href: '/stats', label: 'Estadísticas' },
]

export default function Nav() {
  const pathname = usePathname()
  return (
    <nav className="nav">
      <div className="nav-inner">
        <div className="nav-logo">Okami <span>APP</span></div>
        {TABS.map(t => (
          <Link
            key={t.href}
            href={t.href}
            className={`tab ${pathname === t.href ? 'activo' : ''}`}
          >
            {t.label}
          </Link>
        ))}
      </div>
    </nav>
  )
}
