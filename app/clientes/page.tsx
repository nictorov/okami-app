'use client'
import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { Cliente, ConsentimientoResumen, formatRut, normalizarRut } from '@/lib/types'

const PAGINA = 50

export default function ClientesPage() {
  const [loading, setLoading] = useState(true)
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [total, setTotal] = useState(0)
  const [busqueda, setBusqueda] = useState('')
  const [abierto, setAbierto] = useState<string | null>(null)
  const [historial, setHistorial] = useState<Record<string, ConsentimientoResumen[]>>({})

  const cargar = useCallback(async () => {
    setLoading(true)
    let query = supabase.from('clientes').select('*', { count: 'exact' })
    const q = busqueda.trim()
    if (q) {
      const rutNorm = normalizarRut(q)
      if (rutNorm.length >= 5 && /^[0-9]+[0-9K]$/.test(rutNorm)) {
        query = query.ilike('rut', `${rutNorm}%`)
      } else {
        query = query.or(`nombre.ilike.%${q}%,telefono.ilike.%${q}%,email.ilike.%${q}%`)
      }
    }
    const { data, count } = await query.order('created_at', { ascending: false }).limit(PAGINA)
    setClientes(data ?? [])
    setTotal(count ?? 0)
    setLoading(false)
  }, [busqueda])

  useEffect(() => {
    const timer = setTimeout(cargar, 300)
    return () => clearTimeout(timer)
  }, [cargar])

  async function abrirFicha(c: Cliente) {
    if (abierto === c.id) { setAbierto(null); return }
    setAbierto(c.id)
    if (!historial[c.id] && c.rut) {
      // Historial: consentimientos firmados con el mismo RUT (cruce por rut normalizado)
      const { data } = await supabase
        .from('consentimientos')
        .select('id, folio, nombre, rut, tatuador, estado, created_at, firmado_en')
        .order('created_at', { ascending: false })
        .limit(500)
      const propios = (data ?? []).filter(x => normalizarRut(x.rut) === c.rut)
      setHistorial(h => ({ ...h, [c.id]: propios }))
    }
  }

  async function actualizar(id: string, cambios: Partial<Cliente>) {
    setClientes(cs => cs.map(c => c.id === id ? { ...c, ...cambios } : c))
    await supabase.from('clientes').update({ ...cambios, updated_at: new Date().toISOString() }).eq('id', id)
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
        <h1>Clientes</h1>
        <span style={{ color: 'var(--text2)', fontSize: '0.85rem' }}>{total} en cartera</span>
      </div>

      <input
        placeholder="Buscar por nombre, RUT, teléfono o email…"
        value={busqueda}
        onChange={e => setBusqueda(e.target.value)}
        style={{ marginBottom: 16 }}
      />

      {loading ? <div className="spinner" /> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {clientes.map(c => {
            const expandido = abierto === c.id
            const hist = historial[c.id]
            return (
              <div key={c.id} className="card" style={{ padding: 14 }}>
                <div
                  onClick={() => abrirFicha(c)}
                  style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', cursor: 'pointer' }}
                >
                  <strong style={{ minWidth: 180 }}>{c.nombre}</strong>
                  <span style={{ color: 'var(--text3)', fontSize: '0.82rem' }}>{formatRut(c.rut)}</span>
                  {c.telefono && <span style={{ color: 'var(--text2)', fontSize: '0.82rem' }}>{c.telefono}</span>}
                  {c.marketing_ok && <span className="pill ok">Marketing OK</span>}
                  <span style={{ marginLeft: 'auto', color: 'var(--text3)' }}>{expandido ? '▲' : '▼'}</span>
                </div>

                {expandido && (
                  <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 14 }}>
                    <div className="fila-form">
                      <div>
                        <label>Teléfono</label>
                        <input value={c.telefono ?? ''}
                          onChange={e => setClientes(cs => cs.map(x => x.id === c.id ? { ...x, telefono: e.target.value } : x))}
                          onBlur={e => actualizar(c.id, { telefono: e.target.value.trim() || null })} />
                      </div>
                      <div>
                        <label>Email</label>
                        <input value={c.email ?? ''}
                          onChange={e => setClientes(cs => cs.map(x => x.id === c.id ? { ...x, email: e.target.value } : x))}
                          onBlur={e => actualizar(c.id, { email: e.target.value.trim() || null })} />
                      </div>
                      <div>
                        <label>Instagram</label>
                        <input value={c.instagram ?? ''} placeholder="@usuario"
                          onChange={e => setClientes(cs => cs.map(x => x.id === c.id ? { ...x, instagram: e.target.value } : x))}
                          onBlur={e => actualizar(c.id, { instagram: e.target.value.trim() || null })} />
                      </div>
                      <div>
                        <label>¿Cómo nos conoció?</label>
                        <select value={c.como_nos_conocio ?? ''}
                          onChange={e => actualizar(c.id, { como_nos_conocio: e.target.value || null })}>
                          <option value="">—</option>
                          <option value="instagram">Instagram</option>
                          <option value="recomendacion">Recomendación</option>
                          <option value="walk_in">Pasó por el local</option>
                          <option value="web">Web</option>
                          <option value="otro">Otro</option>
                        </select>
                      </div>
                    </div>

                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, margin: 0, cursor: 'pointer', fontSize: '0.88rem', color: 'var(--text)' }}>
                      <input type="checkbox" checked={c.marketing_ok}
                        onChange={e => actualizar(c.id, { marketing_ok: e.target.checked })}
                        style={{ width: 'auto' }} />
                      Acepta recibir comunicaciones (marketing)
                    </label>

                    <div>
                      <label>Notas</label>
                      <textarea rows={2} value={c.notas ?? ''}
                        onChange={e => setClientes(cs => cs.map(x => x.id === c.id ? { ...x, notas: e.target.value } : x))}
                        onBlur={e => actualizar(c.id, { notas: e.target.value.trim() || null })} />
                    </div>

                    <div>
                      <label style={{ marginBottom: 6 }}>Historial de consentimientos</label>
                      {!hist ? <div className="spinner" /> : hist.length === 0 ? (
                        <p style={{ color: 'var(--text3)', fontSize: '0.85rem' }}>Sin consentimientos registrados.</p>
                      ) : (
                        <table>
                          <thead>
                            <tr><th>Folio</th><th>Fecha</th><th>Tatuador</th><th>Estado</th></tr>
                          </thead>
                          <tbody>
                            {hist.map(h => (
                              <tr key={h.id}>
                                <td>{h.folio}</td>
                                <td>{h.created_at ? new Date(h.created_at).toLocaleDateString('es-CL') : '—'}</td>
                                <td>{h.tatuador}</td>
                                <td><span className={`pill ${h.estado === 'firmado' ? 'ok' : ''}`}>{h.estado}</span></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
          {clientes.length === 0 && (
            <div className="vacio">
              {busqueda ? 'Sin resultados.' : 'Sin clientes aún. Ejecuta la migración 002 para importar desde consentimientos.'}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
