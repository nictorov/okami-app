'use client'
// Módulo copiado de okami-consentimientos (/admin), adaptado:
// - Solo la pestaña Registro (la gestión de tatuadores ya vive en /tatuadores)
// - Protegido por rol Admin
import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { Consentimiento } from '@/lib/types'
import { generarPDFConsentimiento, generarPDFMensual } from '@/lib/pdf'
import SoloRoles from '@/components/SoloRoles'

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
const POR_PAG = 30
const ANIOS = [2024, 2025, 2026, 2027]

interface TatuadorDatosRow {
  nombre: string
  rut: string | null
  nacimiento: string | null
  telefono: string | null
}

function ConsentAdminPage() {
  const now = new Date()
  const [registros, setRegistros] = useState<Consentimiento[]>([])
  const [tatuadores, setTatuadores] = useState<TatuadorDatosRow[]>([])
  const [buscar, setBuscar] = useState('')
  const [loading, setLoading] = useState(true)
  const [visMes, setVisMes] = useState(now.getMonth())
  const [visAnio, setVisAnio] = useState(now.getFullYear())
  const [pagina, setPagina] = useState(1)

  const fetchRegistros = useCallback(async (mes: number, anio: number) => {
    setLoading(true)
    setPagina(1)
    const desde = new Date(anio, mes, 1).toISOString()
    const hasta = new Date(anio, mes + 1, 0, 23, 59, 59).toISOString()
    const { data } = await supabase.from('consentimientos')
      .select('*').eq('estado', 'firmado')
      .gte('firmado_en', desde).lte('firmado_en', hasta)
      .order('firmado_en', { ascending: false })
    setRegistros(data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchRegistros(visMes, visAnio)
    supabase.from('tatuadores').select('nombre, rut, nacimiento, telefono')
      .then(({ data }) => setTatuadores(data ?? []))
  }, [fetchRegistros, visMes, visAnio])

  const filtrados = registros.filter(r =>
    r.nombre.toLowerCase().includes(buscar.toLowerCase()) ||
    r.folio.toLowerCase().includes(buscar.toLowerCase()) ||
    r.tatuador.toLowerCase().includes(buscar.toLowerCase()) ||
    (r.tatuador_otro ?? '').toLowerCase().includes(buscar.toLowerCase())
  )
  const totalPags = Math.ceil(filtrados.length / POR_PAG)
  const paginados = filtrados.slice((pagina - 1) * POR_PAG, pagina * POR_PAG)

  const initials = (n: string) => n.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase()

  const descargarConsentimiento = (r: Consentimiento) => {
    if (r.tatuador !== 'Otro') {
      const tat = tatuadores.find(t => t.nombre === r.tatuador)
      if (tat) {
        generarPDFConsentimiento({ ...r, tatuador_datos: {
          nombre: tat.nombre, rut: tat.rut ?? '—',
          nac: tat.nacimiento ?? '', tel: tat.telefono ?? ''
        }})
        return
      }
    }
    generarPDFConsentimiento(r)
  }

  const descargarMensual = () => {
    if (!registros.length) { alert(`No hay registros firmados en ${MESES[visMes]} ${visAnio}.`); return }
    generarPDFMensual(registros, visMes, visAnio, MESES[visMes])
  }

  return (
    <div className="consent">
    <div className="page">
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontWeight: 500, fontSize: 16, marginBottom: 4 }}>Consentimientos — Registro</div>
        <div style={{ fontSize: 13, color: 'var(--text2)' }}>
          Documentos firmados por mes. La gestión de tatuadores está en la sección Tatuadores de la APP.
        </div>
      </div>

      <div className="card">
        <div className="section-title">Registro mensual</div>
        <div className="export-bar">
          <select value={visMes} onChange={e => setVisMes(parseInt(e.target.value))}>
            {MESES.map((m, i) => <option key={i} value={i}>{m}</option>)}
          </select>
          <select value={visAnio} onChange={e => setVisAnio(parseInt(e.target.value))}>
            {ANIOS.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
          <span className="export-count">
            {registros.length === 0 ? 'Sin registros' : `${registros.length} registro${registros.length > 1 ? 's' : ''}`}
          </span>
          <button className="btn small" onClick={descargarMensual}>Descargar PDF mensual</button>
        </div>
      </div>

      <input
        style={{ marginBottom: 14 }}
        placeholder="Buscar nombre, folio o tatuador..."
        value={buscar} onChange={e => { setBuscar(e.target.value); setPagina(1) }}
      />

      {loading && <div className="spinner" />}

      {!loading && (
        <div className="card">
          {paginados.length === 0 ? (
            <div className="empty">Sin registros para este período</div>
          ) : (
            paginados.map(r => (
              <div key={r.folio} className="record-row">
                <div className="avatar">{initials(r.nombre)}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>
                    {r.nombre}
                    {r.menor && <span className="tag menor">Menor</span>}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 2 }}>
                    {r.folio} · {r.tatuador === 'Otro' ? (r.tatuador_otro ?? 'Invitado') : r.tatuador}
                    {r.firmado_en && ` · ${new Date(r.firmado_en).toLocaleDateString('es-CL')}`}
                  </div>
                </div>
                <button className="btn small outline" onClick={() => descargarConsentimiento(r)}>
                  PDF
                </button>
              </div>
            ))
          )}
          {totalPags > 1 && (
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', alignItems: 'center', paddingTop: 12 }}>
              <button className="btn small outline" disabled={pagina <= 1}
                onClick={() => setPagina(p => p - 1)}>←</button>
              <span style={{ fontSize: 12, color: 'var(--text2)' }}>{pagina} / {totalPags}</span>
              <button className="btn small outline" disabled={pagina >= totalPags}
                onClick={() => setPagina(p => p + 1)}>→</button>
            </div>
          )}
        </div>
      )}
    </div>
    </div>
  )
}

export default function ConsentAdminProtegida() {
  return <SoloRoles roles={['admin']}><ConsentAdminPage /></SoloRoles>
}
