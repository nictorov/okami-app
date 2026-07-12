'use client'
// Módulo copiado de okami-consentimientos (/tatuador), adaptado:
// - Si hay sesión de rol tatuador, queda seleccionado automáticamente
// - Al imprimir y firmar, vincula el consentimiento a la atención agendada
//   del día (si existe) o genera una atención "agenda privada" + ficha de cliente
import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { Consentimiento, normalizarRut } from '@/lib/types'
import { generarPDFConsentimiento } from '@/lib/pdf'
import { useSesion } from '@/lib/sesion'
import {
  TatuadorItem, RutInput, TelefonoInput, TatuadorSearch,
  ModalImprimirFirmar, displayTatuador, telefonoCompleto,
} from '@/components/consent-ui'

const EXPIRY_MS = 12 * 60 * 60 * 1000
const STORAGE_KEY = 'okami_tatuador_nombre'
const TIPOS = ['Realismo', 'Blackwork', 'Neotradicional', 'Tradicional', 'Japonés', 'Acuarela', 'Geométrico', 'Lettering', 'Tribal', 'Fine line', 'Cover', 'Otro']

function IdentidadForm({ folio, onSave }: {
  folio: string
  onSave: (f: string, nombre: string, rut: string, nac: string, tel: string) => void
}) {
  const [nombre, setNombre] = useState('')
  const [rut, setRut] = useState('')
  const [nac, setNac] = useState('')
  const [telPrefijo, setTelPrefijo] = useState('+569')
  const [telNum, setTelNum] = useState('')
  return (
    <>
      <div className="banner warning">Ingresa tus datos como tatuador invitado.</div>
      <label>Tu nombre completo</label>
      <input value={nombre} onChange={e => setNombre(e.target.value)} placeholder="Nombre completo" />
      <label>Tu RUT</label>
      <RutInput value={rut} onChange={setRut} />
      <label>Fecha de nacimiento</label>
      <input type="date" value={nac} onChange={e => setNac(e.target.value)} />
      <label>Teléfono</label>
      <TelefonoInput prefijo={telPrefijo} num={telNum} onPrefijo={setTelPrefijo} onNum={setTelNum} />
      <button className="btn" style={{ marginTop: 12 }}
        onClick={() => onSave(folio, nombre, rut, nac, telefonoCompleto(telPrefijo, telNum))}>
        Guardar y continuar
      </button>
    </>
  )
}

export default function ConsentTatuadorPage() {
  const { sesion } = useSesion()
  const [tatuadores, setTatuadores] = useState<TatuadorItem[]>([])
  const [selTatuador, setSelTatuador] = useState('')
  const [docs, setDocs] = useState<Consentimiento[]>([])
  const [impresosRec, setImpresosRec] = useState<Consentimiento[]>([])
  const [loading, setLoading] = useState(false)
  const [modalFolio, setModalFolio] = useState<string | null>(null)
  const [workState, setWorkState] = useState<Record<string, {
    desc: string; zona: string; tipo: string; med: string
  }>>({})
  const [loadingMemoria, setLoadingMemoria] = useState(true)

  useEffect(() => {
    supabase.from('tatuadores')
      .select('id, nombre, nombre_artistico, archivado, eliminado')
      .eq('activo', true).order('nombre')
      .then(async ({ data }) => {
        const lista = (data ?? []).filter(t => !t.archivado && !t.eliminado)
        setTatuadores(lista)
        // Sesión de tatuador → auto-seleccionado; si no, memoria local
        if (sesion?.rol === 'tatuador' && sesion.tatuadorId) {
          const yo = lista.find(t => (t as { id?: string }).id === sesion.tatuadorId)
          if (yo) setSelTatuador(yo.nombre)
        } else {
          try {
            const saved = localStorage.getItem(STORAGE_KEY)
            if (saved) setSelTatuador(saved)
          } catch { /* sin memoria */ }
        }
        setLoadingMemoria(false)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const elegirTatuador = (nombre: string) => {
    setSelTatuador(nombre)
    try { localStorage.setItem(STORAGE_KEY, nombre) } catch { /* sin memoria */ }
  }

  const olvidarTatuador = () => {
    setSelTatuador('')
    try { localStorage.removeItem(STORAGE_KEY) } catch { /* sin memoria */ }
  }

  const fetchDocs = useCallback(async (tat: string) => {
    if (!tat) { setDocs([]); setImpresosRec([]); return }
    setLoading(true)
    const cutoff = new Date(Date.now() - EXPIRY_MS).toISOString()

    const { data: pendientes } = await supabase.from('consentimientos')
      .select('*').eq('tatuador', tat).eq('estado', 'pendiente').gte('created_at', cutoff)
      .order('created_at', { ascending: false })

    const { data: impresos } = await supabase.from('consentimientos')
      .select('*').eq('tatuador', tat).eq('estado', 'firmado').not('impreso_en', 'is', null).gte('impreso_en', cutoff)
      .order('impreso_en', { ascending: false })

    setDocs(pendientes ?? [])
    setImpresosRec(impresos ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { fetchDocs(selTatuador) }, [selTatuador, fetchDocs])

  const timeLeft = (createdAt: string) => {
    const ms = EXPIRY_MS - (Date.now() - new Date(createdAt).getTime())
    if (ms <= 0) return null
    const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000)
    return { h, m, ms }
  }
  const formatLeft = (createdAt: string) => {
    const t = timeLeft(createdAt); if (!t) return 'Expirado'
    return t.h > 0 ? `Expira en ${t.h}h ${t.m}m` : `Expira en ${t.m}m`
  }
  const formatImpreso = (impreso_en: string) => {
    const ms = Date.now() - new Date(impreso_en).getTime()
    const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000)
    if (h > 0) return `Impreso hace ${h}h ${m}m`
    return `Impreso hace ${m}m`
  }

  const guardarIdentidad = async (folio: string, nombre: string, rut: string, nac: string, tel: string) => {
    if (!nombre) { alert('El nombre es obligatorio.'); return }
    if (!rut) { alert('El RUT es obligatorio.'); return }
    if (!nac) { alert('La fecha de nacimiento es obligatoria.'); return }
    if (!tel) { alert('El teléfono es obligatorio.'); return }
    await supabase.from('consentimientos').update({
      tatuador_datos: { nombre, rut, nac, tel },
      tatuador_otro: nombre,
    }).eq('folio', folio)
    fetchDocs(selTatuador)
  }

  const guardarWork = async (folio: string) => {
    const w = workState[folio]
    if (!w?.desc) { alert('La descripción del tatuaje es obligatoria.'); return }
    if (!w?.zona) { alert('La zona del cuerpo es obligatoria.'); return }
    await supabase.from('consentimientos').update({
      descripcion: w.desc,
      zona: w.zona,
      tipo_tatuaje: w.tipo,
      condiciones_medicas: w.med,
      work_filled: true,
    }).eq('folio', folio)
    fetchDocs(selTatuador)
  }

  const descargarPDF = async (r: Consentimiento) => {
    if (r.tatuador !== 'Otro') {
      const { data } = await supabase.from('tatuadores')
        .select('nombre, rut, nacimiento, telefono').eq('nombre', r.tatuador).single()
      if (data) {
        generarPDFConsentimiento({ ...r, tatuador_datos: {
          nombre: data.nombre ?? r.tatuador,
          rut: data.rut ?? '—',
          nac: data.nacimiento ?? '',
          tel: data.telefono ?? '',
        }}); return
      }
    }
    generarPDFConsentimiento(r)
  }

  // Integración con la APP: al firmar, deja el trío consentimiento +
  // cliente + atención conectados.
  const integrarConAtencion = async (r: Consentimiento) => {
    // 1. Ficha de cliente por RUT (crear si no existe)
    const rutNorm = normalizarRut(r.rut)
    let clienteId: string | null = null
    if (rutNorm) {
      const { data: cl } = await supabase.from('clientes').select('id').eq('rut', rutNorm).maybeSingle()
      if (cl) clienteId = cl.id
      else {
        const { data: nuevoCl } = await supabase.from('clientes').insert({
          rut: rutNorm, nombre: r.nombre,
          telefono: r.telefono || null,
          direccion: r.direccion || null,
          nacimiento: r.nacimiento || null,
        }).select('id').single()
        clienteId = nuevoCl?.id ?? null
      }
    }
    // 2. Tatuador del sistema (para 'Otro' queda en manos del admin)
    const { data: tat } = await supabase.from('tatuadores')
      .select('id').eq('nombre', r.tatuador).maybeSingle()
    if (!tat) return
    // 3. Atención de hoy de ese tatuador sin consentimiento → vincular;
    //    si no hay, crear una "agenda privada" en curso
    const hoy = new Date()
    const dia = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`
    const { data: agendadas } = await supabase.from('atenciones')
      .select('id, cliente_id, consentimiento_id')
      .eq('tatuador_id', tat.id)
      .gte('inicio', `${dia}T00:00:00`).lte('inicio', `${dia}T23:59:59`)
      .in('estado', ['agendada', 'en_curso'])
      .is('consentimiento_id', null)
    const candidata =
      (agendadas ?? []).find(a => a.cliente_id && a.cliente_id === clienteId) ??
      (agendadas ?? []).find(a => !a.cliente_id)
    if (candidata) {
      await supabase.from('atenciones').update({
        consentimiento_id: r.id,
        cliente_id: candidata.cliente_id ?? clienteId,
        estado: 'en_curso',
        updated_at: new Date().toISOString(),
      }).eq('id', candidata.id)
    } else {
      await supabase.from('atenciones').insert({
        cliente_id: clienteId,
        tatuador_id: tat.id,
        consentimiento_id: r.id,
        inicio: new Date().toISOString(),
        estado: 'en_curso',
        tipo: 'agenda_privada',
      })
    }
  }

  const handleAceptarImprimir = async () => {
    if (!modalFolio) return
    const folio = modalFolio
    const r = docs.find(d => d.folio === folio)
    if (!r) return
    setModalFolio(null)
    await descargarPDF(r)
    const ahora = new Date().toISOString()
    await supabase.from('consentimientos').update({
      estado: 'firmado',
      impreso_en: ahora,
      firmado_en: ahora,
    }).eq('folio', folio)
    await integrarConAtencion(r)
    fetchDocs(selTatuador)
  }

  const setW = (folio: string, field: string, val: string) =>
    setWorkState(prev => ({ ...prev, [folio]: { ...prev[folio], [field]: val } }))

  const tatInfo = tatuadores.find(t => t.nombre === selTatuador)
  const tatDisplay = tatInfo ? displayTatuador(tatInfo) : selTatuador

  if (loadingMemoria) return <div className="consent"><div className="page"><div className="spinner" /></div></div>

  return (
    <div className="consent">
    <div className="page">
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontWeight: 500, fontSize: 16, marginBottom: 4 }}>Estudio Okami — Tatuador</div>
        <div style={{ fontSize: 13, color: 'var(--text2)' }}>Completa los datos del trabajo y descarga los documentos de tus clientes</div>
      </div>

      {selTatuador ? (
        <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 2 }}>Conectado como</div>
            <div style={{ fontSize: 15, fontWeight: 500 }}>{tatDisplay}</div>
          </div>
          {sesion?.rol !== 'tatuador' && (
            <button className="btn outline"
              style={{ marginTop: 0, width: 'auto', padding: '8px 14px', fontSize: 12 }}
              onClick={olvidarTatuador}>
              No soy yo
            </button>
          )}
        </div>
      ) : (
        <div className="card">
          <div className="section-title">¿Quién eres?</div>
          <TatuadorSearch tatuadores={tatuadores} value={selTatuador} onChange={elegirTatuador} conOtro={false} />
          <div style={{ marginTop: 12, textAlign: 'center' }}>
            <button className="btn outline"
              style={{ marginTop: 0, width: 'auto', padding: '6px 16px', fontSize: 12,
                color: 'var(--text2)', borderColor: 'var(--border)' }}
              onClick={() => elegirTatuador('Otro')}>
              Soy guest / tatuador invitado
            </button>
          </div>
        </div>
      )}

      {loading && <div className="spinner" />}

      {!loading && selTatuador && docs.length === 0 && impresosRec.length === 0 && (
        <div className="card"><div className="empty">No hay documentos pendientes</div></div>
      )}

      {docs.map(r => {
        const needsIdentidad = r.tatuador === 'Otro' && !r.tatuador_datos
        const tl = r.created_at ? timeLeft(r.created_at) : null
        const urgent = tl && tl.ms < 2 * 3600000
        const w = workState[r.folio] ?? {
          desc: r.descripcion ?? '', zona: r.zona ?? '',
          tipo: r.tipo_tatuaje ?? '', med: r.condiciones_medicas ?? ''
        }

        return (
          <div className="card" key={r.folio}>
            {r.menor && (
              <div style={{ background: '#fff3cd', border: '2px solid #e6a817',
                borderRadius: 8, padding: '10px 14px', marginBottom: 12 }}>
                <div style={{ fontWeight: 700, fontSize: 13, color: '#7a4f00', marginBottom: 3 }}>
                  Aviso — Cliente menor de edad
                </div>
                <div style={{ fontSize: 12, color: '#7a4f00', lineHeight: 1.5 }}>
                  Por exigencia regulatoria, el tutor o apoderado legal debe estar <strong>presente durante toda la sesión</strong>. No se puede realizar el tatuaje sin su presencia y firma en el documento.
                </div>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
              <div>
                <span style={{ fontSize: 14, fontWeight: 500 }}>{r.nombre}</span>
                {r.menor && <span className="tag menor">Menor de edad</span>}
                {r.work_filled
                  ? <span className="tag done">Trabajo listo</span>
                  : <span className="tag pending">Falta trabajo</span>}
                <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 2 }}>{r.fecha_display} {r.hora_display}</div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                <span className="folio-badge">{r.folio}</span>
                {r.created_at && (
                  <span className={`expiry-badge${urgent ? ' urgent' : ''}`}>{formatLeft(r.created_at)}</span>
                )}
              </div>
            </div>

            {needsIdentidad ? (
              <IdentidadForm folio={r.folio} onSave={guardarIdentidad} />
            ) : r.work_filled ? (
              <>
                <div style={{ background: 'var(--bg2)', borderRadius: 8, padding: 12, fontSize: 12, marginBottom: 4 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                    <div><span style={{ color: 'var(--text2)' }}>Descripción:</span> {r.descripcion}</div>
                    <div><span style={{ color: 'var(--text2)' }}>Zona:</span> {r.zona}</div>
                    <div><span style={{ color: 'var(--text2)' }}>Tipo:</span> {r.tipo_tatuaje}</div>
                    <div><span style={{ color: 'var(--text2)' }}>Condiciones:</span> {r.condiciones_medicas || '—'}</div>
                  </div>
                </div>
                <div className="btn-row">
                  <button className="btn outline" onClick={async () => {
                    await supabase.from('consentimientos').update({ work_filled: false }).eq('folio', r.folio)
                    fetchDocs(selTatuador)
                  }}>Editar</button>
                  <button className="btn success" onClick={() => setModalFolio(r.folio)}>
                    Imprimir y firmar
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="banner info">Completa los datos del trabajo para generar el documento.</div>
                <label>Descripción del tatuaje</label>
                <input value={w.desc} onChange={e => setW(r.folio, 'desc', e.target.value)} placeholder="Ej: Flor japonesa con colores" />
                <label>Zona del cuerpo</label>
                <input value={w.zona} onChange={e => setW(r.folio, 'zona', e.target.value)} placeholder="Ej: Antebrazo izquierdo" />
                <label>Tipo de tatuaje</label>
                <select value={w.tipo} onChange={e => setW(r.folio, 'tipo', e.target.value)}>
                  <option value="">Selecciona...</option>
                  {TIPOS.map(t => <option key={t}>{t}</option>)}
                </select>
                <label>Condiciones médicas y comentarios</label>
                <textarea value={w.med} onChange={e => setW(r.folio, 'med', e.target.value)} placeholder="Sin condiciones / alergias / etc." />
                <button className="btn" style={{ marginTop: 12 }} onClick={() => guardarWork(r.folio)}>
                  Guardar datos del trabajo
                </button>
              </>
            )}
          </div>
        )
      })}

      {selTatuador && (
        <>
          <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--text2)', textTransform: 'uppercase',
            letterSpacing: '0.07em', margin: '20px 0 8px' }}>
            Consentimientos impresos recientemente
          </div>
          <div className="card">
            {impresosRec.length === 0 ? (
              <div className="empty" style={{ fontSize: 12 }}>Ninguno en las últimas 12 horas</div>
            ) : (
              impresosRec.map(r => (
                <div key={r.folio} style={{ display: 'flex', alignItems: 'center', gap: 10,
                  padding: '10px 0', borderBottom: '0.5px solid var(--border)' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{r.nombre}
                      <span className="tag done">Impreso</span>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 2 }}>
                      {r.folio}
                      {r.impreso_en && ` · ${formatImpreso(r.impreso_en)}`}
                    </div>
                  </div>
                  <button className="btn small outline" onClick={() => descargarPDF(r)}>
                    Reimprimir
                  </button>
                </div>
              ))
            )}
          </div>
        </>
      )}

      {modalFolio && (
        <ModalImprimirFirmar
          folio={modalFolio}
          onAceptar={handleAceptarImprimir}
          onCancelar={() => setModalFolio(null)}
        />
      )}
    </div>
    </div>
  )
}
