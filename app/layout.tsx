import type { Metadata } from 'next'
import './globals.css'
import AuthGate from '@/components/AuthGate'
import Nav from '@/components/Nav'

export const metadata: Metadata = {
  title: 'Okami APP',
  description: 'Gestión integral del Estudio Okami',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>
        <AuthGate>
          <Nav />
          <main className="contenedor">{children}</main>
        </AuthGate>
      </body>
    </html>
  )
}
