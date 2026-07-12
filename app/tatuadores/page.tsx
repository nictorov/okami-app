'use client'
import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { Tatuador, Estilo, TatuadorEstilo, Sesion, SESION_ESTADO_LABEL, formatRut, formatCLP } from '@/lib/types'
import SoloRoles from '@/components/SoloRoles'

type SesionConCliente = Sesion & { proyecto: { cliente: { nombre: string } | null } | null }

const TIPO_LABEL: Record<'full' | 'compartido' | 'rotativo' | 'guest', string> = {
  full: 'Full', compartido: 'Compartido', rotativo: 'Rotativo', guest: 'Guest',
}


function mesActual(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function hoyISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function estadoDoc(vence: string | null): { label: string; clase: string } {
  if (!vence) return { label: 'No presentada', clase: 'peligro' }
  if (vence < hoyISO()) return { label: `Vencida ${vence}`, clase: 'peligro' }
  return { label: `Al día · vence ${vence}`, clase: 'ok' }
}

function TatuadoresPage() {
  const [loading, setLoading] = useState(true)
  const [tatuadores, setTatuadores] = useState<Tatuador[]>([])
  const [estilos, setEstilos] = useState<Estilo[]>([])
  const [skills, setSkills] = useState<TatuadorEstilo[]>([])
  const [abierto, setAbierto] = useState<string | null>(null)
  const [soloSistema, setSoloSistema] = useState(false)
  const [vista, setVista] = useState<'plantel' | 'guest' | 'archivados'>('plantel')
  const [mes, setMes] = useState(mesActual())
  const [sesionesMes, setSesionesMes] = useState<SesionConCliente[] | null>(null)

  const cargar = useCallback(async () => {
    const [t, e, s] = await Promise.all([
      supabase.from('tatuadores').select('*').order('orden'),
      supabase.from('estilos').select('*').eq('activo', true).order('orden'),
      supabase.from('tatuador_estilos').select('*'),
    ])
    setTatuadores(t.data ?? [])
    setEstilos(e.data ?? [])
    setSkills(s.data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { cargar() }, [cargar])

  async function actualizar(id: string, cambios: Partial<Tatuador>) {
    setTatuadores(ts => ts.map(t => t.id === id ? { ...t, ...cambios } : t))
    await supabase.from('tatuadores').update(cambios).eq('id', id)
  }

  async function toggleEstilo(tatuadorId: string, estiloId: string) {
    const existente = skills.find(s => s.tatuador_id === tatuadorId && s.estilo_id === estiloId)
    if (existente) {
      setSkills(ss => ss.filter(s => s.id !== existente.id))
      await supabase.from('tatuador_estilos').delete().eq('id', existente.id)
    } else {
      const { data } = await supabase.from('tatuador_estilos')
        .insert({ tatuador_id: tatuadorId, estilo_id: estiloId, nivel: 3 })
        .select().single()
      if (data) setSkills(ss => [...ss, data])
    }
  }

  async function cambiarNivel(skill: TatuadorEstilo, nivel: number) {
    setSkills(ss => ss.map(s => s.id === skill.id ? { ...s, nivel } : s))
    await supabase.from('tatuador_estilos').update({ nivel }).eq('id', skill.id)
  }

  // Sesiones del tatuador abierto, cargadas mes a mes (liviano para la UI y la base)
  useEffect(() => {
    if (!abierto) { setSesionesMes(null); return }
    let cancelado = false
    async function cargarSesiones() {
      setSesionesMes(null)
      const [anio, mesNum] = mes.split('-').map(Number)
      const desde = `${mes}-01T00:00:00`
      const hasta = new Date(anio, mesNum, 1).toISOString() // 1° del mes siguiente
      const { data } = await supabase
        .from('sesiones')
        .select('*, proyecto:proyectos(cliente:clientes(nombre))')
        .eq('tatuador_id', abierto)
        .gte('inicio', desde).lt('inicio', hasta)
        .order('inicio', { ascending: false })
      if (!cancelado) setSesionesMes((data as SesionConCliente[]) ?? [])
    }
    cargarSesiones()
    return () => { cancelado = true }
  }, [abierto, mes])

  function archivar(t: Tatuador) {
    if (!confirm(`¿Archivar a ${t.nombre_artistico || t.nombre}? Se conserva toda su información e historial, pero sale del plantel (y del listado de la app de consentimientos).`)) return
    actualizar(t.id, {
      archivado: true,
      archivado_en: new Date().toISOString(),
      activo: false,
      participa_cotizaciones: false,
    })
    setAbierto(null)
  }

  function restaurar(t: Tatuador) {
    actualizar(t.id, { archivado: false, archivado_en: null, activo: true })
  }

  function eliminar(t: Tatuador) {
    if (!confirm(`¿Eliminar a ${t.nombre_artistico || t.nombre} de la plataforma? Quedará oculto en todas partes. Sus datos e historial NO se borran de la base de datos (esta acción solo se puede revertir desde Supabase).`)) return
    actualizar(t.id, { eliminado: true })
  }

  if (loading) return <div className="spinner" />

  const visibles = tatuadores.filter(t => !t.eliminado)
  const archivados = visibles.filter(t => t.archivado)
  const guests = visibles.filter(t => !t.archivado && (t.tipo_puesto ?? 'rotativo') === 'guest')
  const lista = vista === 'archivados'
    ? archivados
    : vista === 'guest'
      ? guests
      : visibles.filter(t => !t.archivado
          && (t.tipo_puesto ?? 'rotativo') !== 'guest'
          && (!soloSistema || t.en_sistema))

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8, marginBottom: 18 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <h1>Tatuadores</h1>
          <button
            className={`chico ${vista === 'plantel' ? '' : 'secundario'}`}
            onClick={() => { setVista('plantel'); setAbierto(null) }}
          >Plantel</button>
          <button
            className={`chico ${vista === 'guest' ? '' : 'secundario'}`}
            onClick={() => { setVista('guest'); setAbierto(null) }}
          >Guest ({guests.length})</button>
          <button
            className={`chico ${vista === 'archivados' ? '' : 'secundario'}`}
            onClick={() => { setVista('archivados'); setAbierto(null) }}
          >Archivados ({archivados.length})</button>
        </div>
        {vista === 'plantel' && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, margin: 0, cursor: 'pointer', fontSize: '0.85rem' }}>
            <input type="checkbox" checked={soloSistema} onChange={e => setSoloSistema(e.target.checked)} style={{ width: 'auto' }} />
            Solo en el sistema
          </label>
        )}
      </div>

      {(vista !== 'plantel'
        ? [{ tipo: null as 'full' | 'compartido' | 'rotativo' | null, grupo: lista }]
        : (['full', 'compartido', 'rotativo'] as const).map(tp => ({
            tipo: tp as 'full' | 'compartido' | 'rotativo' | null,
            grupo: lista.filter(t => (t.tipo_puesto ?? 'rotativo') === tp),
          }))
      ).map(({ tipo, grupo }) => grupo.length === 0 ? null : (
      <div key={tipo ?? 'archivados'} style={{ marginBottom: 20 }}>
        {tipo && (
          <h2 style={{ margin: '4px 0 10px', color: 'var(--text2)', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            {TIPO_LABEL[tipo]} ({grupo.length})
          </h2>
        )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {grupo.map(t => {
          const misSkills = skills.filter(s => s.tatuador_id === t.id)
          const vac = estadoDoc(t.vacunacion_vence)
          const ase = estadoDoc(t.asepsia_vence)
          const expandido = abierto === t.id

          if (vista === 'archivados') {
            return (
              <div key={t.id} className="card" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                <strong style={{ minWidth: 160 }}>{t.nombre_artistico || t.nombre}</strong>
                <span style={{ color: 'var(--text3)', fontSize: '0.82rem' }}>{formatRut(t.rut)}</span>
                {t.archivado_en && (
                  <span className="pill">Archivado el {new Date(t.archivado_en).toLocaleDateString('es-CL')}</span>
                )}
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                  <button className="chico secundario" onClick={() => restaurar(t)}>↩ Restaurar al plantel</button>
                  <button className="chico" style={{ background: 'var(--rojo)' }} onClick={() => eliminar(t)}>Eliminar</button>
                </div>
              </div>
            )
          }

          return (
            <div key={t.id} className="card">
              <div
                onClick={() => setAbierto(expandido ? null : t.id)}
                style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', cursor: 'pointer' }}
              >
                <strong style={{ minWidth: 160 }}>{t.nombre_artistico || t.nombre}</strong>
                <span style={{ color: 'var(--text3)', fontSize: '0.82rem' }}>{formatRut(t.rut)}</span>
                {t.en_sistema
                  ? <span className="pill ok">En el sistema</span>
                  : <span className="pill">Fuera del sistema</span>}
                {t.participa_cotizaciones && <span className="pill ok">Recibe cotizaciones</span>}
                {t.en_sistema && (vac.clase === 'peligro' || ase.clase === 'peligro') && (
                  <span className="pill peligro">⚠ Docs</span>
                )}
                <span style={{ marginLeft: 'auto', color: 'var(--text3)' }}>{expandido ? '▲' : '▼'}</span>
              </div>

              {expandido && (
                <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
                  {/* Participación */}
                  <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'center' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, margin: 0, fontSize: '0.88rem', color: 'var(--text)' }}>
                      Tipo:
                      <select
                        value={t.tipo_puesto ?? 'rotativo'}
                        onChange={e => actualizar(t.id, { tipo_puesto: e.target.value as Tatuador['tipo_puesto'] })}
                        style={{ width: 130 }}
                      >
                        <option value="full">Full</option>
                        <option value="compartido">Compartido</option>
                        <option value="rotativo">Rotativo</option>
                        <option value="guest">Guest</option>
                      </select>
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, margin: 0, cursor: 'pointer', fontSize: '0.88rem', color: 'var(--text)' }}>
                      <input type="checkbox" checked={t.en_sistema}
                        onChange={e => actualizar(t.id, { en_sistema: e.target.checked })}
                        style={{ width: 'auto' }} />
                      Participa del sistema (seguimiento)
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, margin: 0, cursor: 'pointer', fontSize: '0.88rem', color: 'var(--text)' }}>
                      <input type="checkbox" checked={t.participa_cotizaciones}
                        onChange={e => actualizar(t.id, { participa_cotizaciones: e.target.checked })}
                        style={{ width: 'auto' }} />
                      Recibe cotizaciones del estudio
                    </label>
                  </div>

                  {/* Datos personales y contacto */}
                  <div className="fila-form">
                    <div>
                      <label>Nombre completo</label>
                      <input value={t.nombre ?? ''}
                        onChange={e => setTatuadores(ts => ts.map(x => x.id === t.id ? { ...x, nombre: e.target.value } : x))}
                        onBlur={e => { if (e.target.value.trim()) actualizar(t.id, { nombre: e.target.value.trim() }) }} />
                    </div>
                    <div>
                      <label>Nombre artístico</label>
                      <input value={t.nombre_artistico ?? ''}
                        onChange={e => setTatuadores(ts => ts.map(x => x.id === t.id ? { ...x, nombre_artistico: e.target.value } : x))}
                        onBlur={e => actualizar(t.id, { nombre_artistico: e.target.value.trim() || null })} />
                    </div>
                    <div>
                      <label>RUT</label>
                      <input value={t.rut ?? ''} placeholder="12.345.678-9"
                        onChange={e => setTatuadores(ts => ts.map(x => x.id === t.id ? { ...x, rut: e.target.value } : x))}
                        onBlur={e => actualizar(t.id, { rut: e.target.value.trim() || null })} />
                    </div>
                  </div>
                  <div className="fila-form">
                    <div>
                      <label>Teléfono</label>
                      <input value={t.telefono ?? ''} placeholder="+569 12345678"
                        onChange={e => setTatuadores(ts => ts.map(x => x.id === t.id ? { ...x, telefono: e.target.value } : x))}
                        onBlur={e => actualizar(t.id, { telefono: e.target.value.trim() || null })} />
                    </div>
                    <div>
                      <label>Fecha de nacimiento</label>
                      <input value={t.nacimiento ?? ''} placeholder="dd-mm-aaaa"
                        onChange={e => setTatuadores(ts => ts.map(x => x.id === t.id ? { ...x, nacimiento: e.target.value } : x))}
                        onBlur={e => actualizar(t.id, { nacimiento: e.target.value.trim() || null })} />
                    </div>
                    <div>
                      <label>Email</label>
                      <input value={t.email ?? ''} placeholder="correo@ejemplo.com"
                        onChange={e => setTatuadores(ts => ts.map(x => x.id === t.id ? { ...x, email: e.target.value } : x))}
                        onBlur={e => actualizar(t.id, { email: e.target.value.trim() || null })} />
                    </div>
                    <div>
                      <label>Instagram</label>
                      <input value={t.instagram ?? ''} placeholder="@usuario"
                        onChange={e => setTatuadores(ts => ts.map(x => x.id === t.id ? { ...x, instagram: e.target.value } : x))}
                        onBlur={e => actualizar(t.id, { instagram: e.target.value.trim() || null })} />
                    </div>
                    <div>
                      <label>PIN de acceso {t.pin ? <span className="pill ok">configurado</span> : <span className="pill">sin PIN</span>}</label>
                      <input value={t.pin ?? ''} placeholder="Ej: 1234"
                        onChange={e => setTatuadores(ts => ts.map(x => x.id === t.id ? { ...x, pin: e.target.value } : x))}
                        onBlur={e => actualizar(t.id, { pin: e.target.value.trim() || null })} />
                    </div>
                  </div>

                  {/* Documentación */}
                  <div className="fila-form">
                    <div>
                      <label>Carnet de vacunación — vencimiento <span className={`pill ${vac.clase}`}>{vac.label}</span></label>
                      <input type="date" value={t.vacunacion_vence ?? ''}
                        onChange={e => actualizar(t.id, { vacunacion_vence: e.target.value || null })} />
                    </div>
                    <div>
                      <label>Curso de asepsia — vencimiento <span className={`pill ${ase.clase}`}>{ase.label}</span></label>
                      <input type="date" value={t.asepsia_vence ?? ''}
                        onChange={e => actualizar(t.id, { asepsia_vence: e.target.value || null })} />
                    </div>
                  </div>

                  {/* Estilos */}
                  <div>
                    <label style={{ marginBottom: 8 }}>Estilos que ofrece (clic para activar; nivel 1–5)</label>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {estilos.map(e => {
                        const skill = misSkills.find(s => s.estilo_id === e.id)
                        return (
                          <div key={e.id} style={{
                            display: 'flex', alignItems: 'center', gap: 6,
                            padding: '5px 10px', borderRadius: 8,
                            border: `1px solid ${skill ? 'var(--accent)' : 'var(--border)'}`,
                            background: skill ? 'var(--accent-soft)' : 'var(--bg3)',
                            fontSize: '0.83rem',
                          }}>
                            <span onClick={() => toggleEstilo(t.id, e.id)} style={{ cursor: 'pointer' }}>
                              {e.nombre}
                            </span>
                            {skill && (
                              <select
                                value={skill.nivel}
                                onChange={ev => cambiarNivel(skill, Number(ev.target.value))}
                                style={{ width: 52, padding: '2px 4px', fontSize: '0.8rem' }}
                              >
                                {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n}</option>)}
                              </select>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>

                  {/* Notas */}
                  <div>
                    <label>Notas</label>
                    <textarea rows={2} value={t.notas ?? ''}
                      onChange={e => setTatuadores(ts => ts.map(x => x.id === t.id ? { ...x, notas: e.target.value } : x))}
                      onBlur={e => actualizar(t.id, { notas: e.target.value.trim() || null })} />
                  </div>

                  {/* Sesiones del mes */}
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                      <label style={{ margin: 0 }}>Sesiones</label>
                      <input
                        type="month"
                        value={mes}
                        onChange={e => e.target.value && setMes(e.target.value)}
                        style={{ width: 170 }}
                      />
                    </div>
                    {!sesionesMes ? <div className="spinner" /> : sesionesMes.length === 0 ? (
                      <p style={{ color: 'var(--text3)', fontSize: '0.85rem' }}>Sin sesiones este mes.</p>
                    ) : (
                      <>
                        <table>
                          <thead>
                            <tr><th>Fecha</th><th>Cliente</th><th>Estado</th><th>Valor</th></tr>
                          </thead>
                          <tbody>
                            {sesionesMes.map(s => (
                              <tr key={s.id}>
                                <td>{new Date(s.inicio).toLocaleDateString('es-CL', { day: '2-digit', month: 'short' })}
                                  {' '}{new Date(s.inicio).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}</td>
                                <td>{s.proyecto?.cliente?.nombre ?? '—'}</td>
                                <td><span className={`pill ${s.estado === 'completada' || s.estado === 'consentimiento_firmado' ? 'ok' : s.estado === 'cancelada' ? 'peligro' : ''}`}>
                                  {SESION_ESTADO_LABEL[s.estado] ?? s.estado}
                                </span></td>
                                <td>{formatCLP(s.valor)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        <p style={{ color: 'var(--text2)', fontSize: '0.82rem', marginTop: 8 }}>
                          {sesionesMes.filter(s => s.estado === 'completada').length} completadas ·{' '}
                          total {formatCLP(sesionesMes.filter(s => s.estado === 'completada')
                            .reduce((sum, s) => sum + (s.valor ?? 0), 0))}
                        </p>
                      </>
                    )}
                  </div>

                  {/* Archivar */}
                  <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14 }}>
                    <button className="chico secundario" onClick={() => archivar(t)}>
                      📦 Archivar tatuador (sale del plantel, conserva su historial)
                    </button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
      </div>
      ))}
    </div>
  )
}

export default function TatuadoresPageProtegida() {
  return <SoloRoles roles={['admin']}><TatuadoresPage /></SoloRoles>
}
