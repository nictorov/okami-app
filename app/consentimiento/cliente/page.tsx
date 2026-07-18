'use client'
// Módulo copiado de okami-consentimientos (/cliente), adaptado:
// - Prellenado automático de datos si el RUT ya existe en la cartera de clientes
// - Al registrar, crea/actualiza la ficha del cliente
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { normalizarRut } from '@/lib/types'
import {
  TatuadorItem, RutInput, TelefonoInput, TatuadorSearch,
  calcEdad, telefonoCompleto, splitTelefono,
} from '@/components/consent-ui'

interface TutorForm {
  nombre: string
  rut: string
  telefonoPrefijo: string
  telefonoNum: string
  parentesco: string
  direccion: string
}

const TUTOR_VACIO: TutorForm = {
  nombre: '', rut: '', telefonoPrefijo: '+569', telefonoNum: '', parentesco: '', direccion: ''
}

// ── Ofuscación de datos precargados ──
// El cliente puede reconocerlos, pero un tercero con el RUT no puede leerlos.
function mid(w: string): string {
  if (w.length <= 1) return w
  if (w.length === 2) return w[0] + w[1]
  return w[0] + '*'.repeat(w.length - 2) + w[w.length - 1]
}
// Nombre: primera palabra completa; el resto solo primera y última letra
function ofuscarNombre(v: string): string {
  const ws = v.trim().split(/\s+/).filter(Boolean)
  if (ws.length === 0) return ''
  return [ws[0], ...ws.slice(1).map(mid)].join(' ')
}
// Fecha ISO (yyyy-mm-dd): todo * salvo el último dígito del año
function ofuscarFecha(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '••/••/••••'
  return `••/••/•••${iso[3]}`
}
// Teléfono (número sin prefijo): solo primer y último dígito
function ofuscarTel(num: string): string {
  const n = num.trim()
  if (n.length <= 2) return n
  return n[0] + '*'.repeat(n.length - 2) + n[n.length - 1]
}
// Dirección: cada palabra solo primera y última letra
function ofuscarDireccion(v: string): string {
  return v.trim().split(/\s+/).filter(Boolean).map(mid).join(' ')
}

// Campo readOnly ofuscado con botón "Editar" para corregir (se vacía al editar)
function CampoOfuscado({ display, onEditar }: { display: string; onEditar: () => void }) {
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <input value={display} readOnly
        style={{ background: 'var(--bg2)', color: 'var(--text2)', cursor: 'default', letterSpacing: '0.05em' }} />
      <button type="button" className="chico secundario" style={{ flexShrink: 0 }} onClick={onEditar}>Editar</button>
    </div>
  )
}

export default function ConsentClientePage() {
  const [tatuadores, setTatuadores] = useState<TatuadorItem[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [folio, setFolio] = useState('')

  const [nombre, setNombre] = useState('')
  const [rut, setRut] = useState('')
  const [esRut, setEsRut] = useState(true)   // false = otro DNI (extranjero), texto libre
  const [nacimiento, setNacimiento] = useState('')
  const [genero, setGenero] = useState('')
  // Campos precargados aún no corregidos por el cliente (se muestran ofuscados)
  const [ofuscados, setOfuscados] = useState<Set<string>>(new Set())
  const revelar = (campo: string, limpiar: () => void) => {
    setOfuscados(prev => { const n = new Set(prev); n.delete(campo); return n })
    limpiar()
  }
  const [edad, setEdad] = useState<number | null>(null)
  const [telPrefijo, setTelPrefijo] = useState('+569')
  const [telNum, setTelNum] = useState('')
  const [direccion, setDireccion] = useState('')
  const [tatuador, setTatuador] = useState('')
  const [tatuadorOtro, setTatuadorOtro] = useState('')
  const [menor, setMenor] = useState(false)
  const [tutor, setTutor] = useState<TutorForm>(TUTOR_VACIO)
  const [clienteConocido, setClienteConocido] = useState(false)

  useEffect(() => {
    supabase.from('tatuadores')
      .select('nombre, nombre_artistico, archivado, eliminado')
      .eq('activo', true)
      .order('nombre')
      .then(({ data }) => {
        setTatuadores((data ?? []).filter(t => !t.archivado && !t.eliminado))
        setLoading(false)
      })
  }, [])

  // Cliente antiguo: prellenar desde la cartera al completar el RUT
  useEffect(() => {
    const rutNorm = normalizarRut(rut)
    if (rutNorm.length < 8) { setClienteConocido(false); return }
    let cancelado = false
    supabase.from('clientes').select('*').eq('rut', rutNorm).maybeSingle()
      .then(({ data }) => {
        if (cancelado || !data) return
        setClienteConocido(true)
        const nuevosOfuscados = new Set<string>()
        if (!nombre && data.nombre) { setNombre(data.nombre); nuevosOfuscados.add('nombre') }
        if (!direccion && data.direccion) { setDireccion(data.direccion); nuevosOfuscados.add('direccion') }
        if (!nacimiento && data.nacimiento && /^\d{4}-\d{2}-\d{2}$/.test(data.nacimiento)) {
          setNacimiento(data.nacimiento)
          const e = calcEdad(data.nacimiento)
          setEdad(e)
          setMenor(e !== null && e < 18)
          nuevosOfuscados.add('nacimiento')
        }
        if (!telNum && data.telefono) {
          const { prefijo, num } = splitTelefono(data.telefono)
          setTelPrefijo(prefijo); setTelNum(num)
          nuevosOfuscados.add('telefono')
        }
        setOfuscados(nuevosOfuscados)
      })
    return () => { cancelado = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rut])

  const onNacimientoChange = (v: string) => {
    setNacimiento(v)
    const e = calcEdad(v)
    setEdad(e)
    setMenor(e !== null && e < 18)
  }

  const handleSubmit = async () => {
    if (!nombre) { alert('El nombre es obligatorio.'); return }
    if (!rut) { alert(esRut ? 'El RUT es obligatorio.' : 'El DNI es obligatorio.'); return }
    if (!nacimiento) { alert('La fecha de nacimiento es obligatoria.'); return }
    if (!telNum) { alert('El teléfono es obligatorio.'); return }
    if (!direccion) { alert('La dirección es obligatoria.'); return }
    if (!tatuador) { alert('Selecciona el tatuador que te atenderá.'); return }
    if (tatuador === 'Otro' && !tatuadorOtro) { alert('Ingresa el nombre del tatuador invitado.'); return }
    if (menor) {
      if (!tutor.nombre) { alert('El nombre del tutor es obligatorio.'); return }
      if (!tutor.rut) { alert('El RUT del tutor es obligatorio.'); return }
      if (!tutor.telefonoNum) { alert('El teléfono del tutor es obligatorio.'); return }
      if (!tutor.direccion) { alert('La dirección del tutor es obligatoria.'); return }
      if (!tutor.parentesco) { alert('El parentesco del tutor es obligatorio.'); return }
    }

    setSubmitting(true)
    const now = new Date()
    const fecha_display = now.toLocaleDateString('es-CL')
    const hora_display = now.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })

    const { data: folioData, error: folioErr } = await supabase.rpc('next_folio')
    if (folioErr || !folioData) { alert('Error al generar folio. Intenta de nuevo.'); setSubmitting(false); return }

    const telefonoFinal = telefonoCompleto(telPrefijo, telNum)
    const tutorTelFinal = telefonoCompleto(tutor.telefonoPrefijo, tutor.telefonoNum)

    const payload = {
      folio: folioData, nombre, rut,
      nacimiento: nacimiento || null,
      edad: edad ?? null,
      telefono: telefonoFinal || null,
      direccion: direccion || null,
      genero: genero || null,
      tatuador,
      tatuador_otro: tatuadorOtro || null,
      menor,
      tutor: menor ? {
        nombre: tutor.nombre,
        rut: tutor.rut,
        telefono: tutorTelFinal || null,
        parentesco: tutor.parentesco,
        direccion: tutor.direccion || null,
      } : null,
      work_filled: false,
      estado: 'pendiente',
      fecha_display,
      hora_display,
    }

    const { error } = await supabase.from('consentimientos').insert(payload)
    if (error) { alert('Error al registrar. Intenta de nuevo.'); setSubmitting(false); return }

    // Ficha de cliente: crear si es nuevo, refrescar contacto si ya existe
    const rutNorm = normalizarRut(rut)
    if (rutNorm) {
      const { data: existente } = await supabase.from('clientes').select('id').eq('rut', rutNorm).maybeSingle()
      if (existente) {
        await supabase.from('clientes').update({
          nombre,
          telefono: telefonoFinal || null,
          direccion: direccion || null,
          nacimiento: nacimiento || null,
          genero: genero || null,
          updated_at: new Date().toISOString(),
        }).eq('id', existente.id)
      } else {
        await supabase.from('clientes').insert({
          rut: rutNorm, nombre,
          telefono: telefonoFinal || null,
          direccion: direccion || null,
          nacimiento: nacimiento || null,
          genero: genero || null,
        })
      }
    }

    setFolio(folioData)
    setNombre(''); setRut(''); setEsRut(true); setNacimiento(''); setEdad(null); setGenero('')
    setTelPrefijo('+569'); setTelNum(''); setDireccion('')
    setTatuador(''); setTatuadorOtro(''); setMenor(false)
    setTutor(TUTOR_VACIO)
    setClienteConocido(false)
    setOfuscados(new Set())
    setSubmitting(false)
  }

  if (loading) return <div className="page"><div className="spinner" /></div>

  return (
    <div className="page">
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontWeight: 500, fontSize: 16, marginBottom: 4 }}>Estudio Okami</div>
        <div style={{ fontSize: 13, color: 'var(--text2)' }}>Completa tus datos para el consentimiento informado</div>
      </div>

      {folio && (
        <div className="banner success">
          Consentimiento registrado con folio <strong>{folio}</strong>. Tu tatuador completará los datos del trabajo y descargará el documento para que lo firmes.
        </div>
      )}

      <div className="card">
        <div className="section-title">Tus datos personales</div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
          <label style={{ margin: 0 }}>{esRut ? 'RUT' : 'Otro DNI (extranjero)'}</label>
          <button type="button" className="chico secundario"
            onClick={() => { setEsRut(!esRut); setRut('') }}>
            {esRut ? 'Usar otro DNI' : 'Usar RUT'}
          </button>
        </div>
        {esRut
          ? <RutInput value={rut} onChange={setRut} />
          : <input value={rut} onChange={e => setRut(e.target.value)} placeholder="Pasaporte u otro documento" />}

        {clienteConocido && (
          <div className="banner info" style={{ marginTop: 10 }}>
            ¡Hola de nuevo! Precargamos tus datos ofuscados — revisa que sean tuyos. Si algo cambió, pulsa &quot;Editar&quot;.
          </div>
        )}

        <label>Nombre completo</label>
        {ofuscados.has('nombre')
          ? <CampoOfuscado display={ofuscarNombre(nombre)} onEditar={() => revelar('nombre', () => setNombre(''))} />
          : <input value={nombre} onChange={e => setNombre(e.target.value)} placeholder="Ej: María González Rojas" />}

        <label>Fecha de nacimiento</label>
        {ofuscados.has('nacimiento')
          ? <CampoOfuscado display={ofuscarFecha(nacimiento)}
              onEditar={() => revelar('nacimiento', () => { setNacimiento(''); setEdad(null); setMenor(false) })} />
          : <input type="date" value={nacimiento} onChange={e => onNacimientoChange(e.target.value)} />}

        <label>Edad</label>
        <input type="text" value={edad !== null ? `${edad} años` : ''} readOnly
          placeholder="Se calcula automáticamente"
          style={{ background: 'var(--bg2)', color: 'var(--text2)', cursor: 'default' }} />

        <label>Género (opcional)</label>
        <select value={genero} onChange={e => setGenero(e.target.value)}>
          <option value="">Prefiero no decir</option>
          <option value="femenino">Femenino</option>
          <option value="masculino">Masculino</option>
          <option value="otro">Otro</option>
        </select>

        <label>Teléfono</label>
        {ofuscados.has('telefono')
          ? <CampoOfuscado display={`${telPrefijo} ${ofuscarTel(telNum)}`}
              onEditar={() => revelar('telefono', () => setTelNum(''))} />
          : <TelefonoInput prefijo={telPrefijo} num={telNum} onPrefijo={setTelPrefijo} onNum={setTelNum} />}

        <label>Dirección</label>
        {ofuscados.has('direccion')
          ? <CampoOfuscado display={ofuscarDireccion(direccion)} onEditar={() => revelar('direccion', () => setDireccion(''))} />
          : <input value={direccion} onChange={e => setDireccion(e.target.value)} placeholder="Calle, número, comuna" />}
      </div>

      {menor && (
        <>
          <div className="banner warning">
            Eres menor de 18 años. Se requieren los datos de tu tutor o apoderado, quien debe estar presente durante toda la sesión.
          </div>
          <div className="card card-warning">
            <div className="section-title">Datos del tutor / apoderado</div>
            <label>Nombre completo</label>
            <input value={tutor.nombre} onChange={e => setTutor({ ...tutor, nombre: e.target.value })} placeholder="Nombre del tutor" />
            <label>RUT</label>
            <RutInput value={tutor.rut} onChange={v => setTutor({ ...tutor, rut: v })} />
            <label>Teléfono</label>
            <TelefonoInput
              prefijo={tutor.telefonoPrefijo} num={tutor.telefonoNum}
              onPrefijo={v => setTutor({ ...tutor, telefonoPrefijo: v })}
              onNum={v => setTutor({ ...tutor, telefonoNum: v })}
            />
            <label>Dirección</label>
            <input value={tutor.direccion} onChange={e => setTutor({ ...tutor, direccion: e.target.value })} placeholder="Calle, número, comuna" />
            <label>Parentesco</label>
            <select value={tutor.parentesco} onChange={e => setTutor({ ...tutor, parentesco: e.target.value })}>
              <option value="">Selecciona...</option>
              <option>Padre/Madre</option>
              <option>Abuelo/Abuela</option>
              <option>Tutor legal</option>
              <option>Otro familiar</option>
            </select>
          </div>
        </>
      )}

      <div className="card">
        <div className="section-title">Tatuador que te atenderá</div>
        <TatuadorSearch tatuadores={tatuadores} value={tatuador} onChange={setTatuador} />
        {tatuador === 'Otro' && (
          <>
            <label>Nombre del tatuador invitado</label>
            <input value={tatuadorOtro} onChange={e => setTatuadorOtro(e.target.value)} placeholder="Nombre completo" />
          </>
        )}
      </div>

      <button className="btn" onClick={handleSubmit} disabled={submitting}>
        {submitting ? 'Registrando...' : 'Registrar consentimiento'}
      </button>
    </div>
  )
}
