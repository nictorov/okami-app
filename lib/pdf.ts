import { Consentimiento } from './types'

type Doc = InstanceType<typeof import('jspdf').jsPDF>

// ─────────────────────────────────────────────────────────────
// REGLA: nunca pasar array a doc.text().
// wl() y wlC() dividen el texto y escriben línea por línea
// con avance FIJO en mm mediante un for loop (no forEach,
// para evitar problemas de mutación de variable en closures).
// ─────────────────────────────────────────────────────────────

function wl(doc: Doc, text: string, x: number, startY: number, maxW: number, lh: number): number {
  const lines: string[] = doc.splitTextToSize(text, maxW)
  let cy = startY
  for (let i = 0; i < lines.length; i++) {
    doc.text(lines[i], x, cy)
    cy = cy + lh
  }
  return cy
}

function wlC(doc: Doc, text: string, cx: number, startY: number, maxW: number, lh: number): number {
  const lines: string[] = doc.splitTextToSize(text, maxW)
  let cy = startY
  for (let i = 0; i < lines.length; i++) {
    doc.text(lines[i], cx, cy, { align: 'center' })
    cy = cy + lh
  }
  return cy
}

// ─────────────────────────────────────────────────────────────

export async function generarPDFConsentimiento(r: Consentimiento): Promise<void> {
  const { jsPDF } = await import('jspdf')
  const tatNombre = r.tatuador_datos?.nombre ?? (r.tatuador_otro ?? r.tatuador)
  const tatRut    = r.tatuador_datos?.rut ?? '—'
  const tatNac    = r.tatuador_datos?.nac ?? '—'
  const tatTel    = r.tatuador_datos?.tel ?? '—'
  const doc = new jsPDF({ unit: 'mm', format: 'letter' })
  buildConsentimiento(doc, r, tatNombre, tatRut, tatNac, tatTel)
  doc.save(`consentimiento_${r.folio}_${r.nombre.replace(/\s+/g, '_')}.pdf`)
}

export async function generarPDFMensual(
  registros: Consentimiento[],
  mes: number,
  anio: number,
  nombreMes: string
): Promise<void> {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'mm', format: 'letter', orientation: 'landscape' })
  const mg  = 12
  const PW  = 279 - mg * 2
  const PH  = 216
  let y = mg
  const tr = (s: string, n: number) => s && s.length > n ? s.slice(0, n - 1) + '...' : (s ?? '--')

  doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(0)
  doc.text('Registro mensual de consentimientos', mg + PW / 2, y, { align: 'center' })
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10)
  doc.text(nombreMes + ' ' + anio + '  -  Total: ' + registros.length + ' registros', mg + PW / 2, y + 7, { align: 'center' })
  doc.setDrawColor(120); doc.line(mg, y + 12, mg + PW, y + 12)
  y = y + 20

  const colW   = [22,  46,  28,  52,  28,  40,  28]
  const headers = ['Fecha', 'Nombre cliente', 'Rut', 'Direccion', 'Telefono', 'Tatuador', 'Folio']
  const cols: number[] = []
  let cx = mg
  for (let i = 0; i < colW.length; i++) { cols.push(cx); cx = cx + colW[i] }

  doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(60)
  for (let i = 0; i < headers.length; i++) doc.text(headers[i], cols[i], y)
  doc.setTextColor(0); y = y + 2
  doc.setDrawColor(150); doc.line(mg, y, mg + PW, y); y = y + 5

  for (let idx = 0; idx < registros.length; idx++) {
    const r = registros[idx]
    if (y > PH - 16) { doc.addPage(); y = mg }
    const tat   = r.tatuador === 'Otro' ? (r.tatuador_otro ?? 'Invitado') : r.tatuador
    const fecha = r.firmado_en
      ? new Date(r.firmado_en).toLocaleDateString('es-CL')
      : (r.fecha_display ?? '--')

    if (idx % 2 === 0) {
      doc.setFillColor(247, 247, 247)
      doc.rect(mg - 1, y - 4, PW + 2, 7, 'F')
    }
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(0)
    doc.text(tr(fecha,               12), cols[0], y)
    doc.text(tr(r.nombre,            24), cols[1], y)
    doc.text(tr(r.rut ?? '--',       16), cols[2], y)
    doc.text(tr(r.direccion ?? '--', 28), cols[3], y)
    doc.text(tr(r.telefono ?? '--',  16), cols[4], y)
    doc.text(tr(tat,                 22), cols[5], y)
    doc.text(tr(r.folio,             16), cols[6], y)
    y = y + 7
  }

  y = y + 4
  doc.setDrawColor(150); doc.line(mg, y, mg + PW, y); y = y + 5
  doc.setFont('helvetica', 'italic'); doc.setFontSize(7.5); doc.setTextColor(130)
  doc.text('Generado el ' + new Date().toLocaleDateString('es-CL') + ' - Estudio Okami', mg, y)
  doc.save('registro_' + nombreMes.toLowerCase() + '_' + anio + '.pdf')
}


// ─────────────────────────────────────────────────────────────
// CONSENTIMIENTO — una sola hoja carta
// MG=10mm, fuente cuerpo 7pt, LH=2.8mm fijo
// ─────────────────────────────────────────────────────────────
function buildConsentimiento(doc: Doc, r: Consentimiento, tatNombre: string, tatRut: string, tatNac: string, tatTel: string) {
  const MG   = 10
  const PW   = 210 - MG * 2   // 190mm
  const PH   = 279
  const MID  = MG + PW / 2    // 105mm
  const LH   = 2.8            // interlineado cuerpo — FIJO
  const LHH  = 3.0            // interlineado encabezado — FIJO

  let y = MG + 1

  const tr = (s: string, n: number) => s && s.length > n ? s.slice(0, n - 1) + '…' : (s ?? '')
  const N  = (b: boolean) => doc.setFont('helvetica', b ? 'bold' : 'normal')
  const S  = (s: number)  => doc.setFontSize(s)
  const TC = (c: number)  => doc.setTextColor(c, c, c)
  const DC = (c: number)  => doc.setDrawColor(c, c, c)
  const HR = () => { DC(150); doc.line(MG, y, 210 - MG, y) }

  // Escribe multilínea left, avanza y
  const WL = (text: string, lh: number, x?: number, maxW?: number) => {
    y = wl(doc, text, x ?? MG, y, maxW ?? PW, lh)
  }

  // Escribe multilínea centrado, avanza y
  const WC = (text: string, lh: number, maxW?: number) => {
    y = wlC(doc, text, MID, y, maxW ?? PW, lh)
  }

  // Título de sección
  const SEC = (t: string) => {
    N(true); S(8); TC(0)
    doc.text(t, MID, y, { align: 'center' })
    y = y + 3.8
  }

  // Item de texto con bullet
  const IT = (text: string) => {
    N(false); S(7); TC(0)
    y = wl(doc, '* ' + text, MG, y, PW, LH)
  }

  // ── 1. ENCABEZADO ────────────────────────────────────────────
  N(true); S(10); TC(0)
  doc.text('INFORMACIÓN OBLIGATORIA AL USUARIO', MG, y)
  N(true); S(8.5)
  doc.text('FOLIO:', 157, y)
  DC(80); doc.rect(168, y - 4, 28, 5.5)
  N(false); S(8); TC(0)
  doc.text(r.folio, 169, y)
  y = y + 4.5

  N(false); S(7); TC(40)
  WL('En conformida al Artículo N° 6, Decreto Supremo N° 304 de 2002, "Reglamento de tatuajes" o equivalente según el Artículo N° 16', LHH, MG, PW - 35)
  N(true); S(8); TC(0)
  doc.text(`FECHA: ${r.fecha_display ?? ''}`, 210 - MG, y, { align: 'right' })
  N(false); S(7); TC(40)
  WL('Sometido al secreto ley N° 19.628 de datos personales. Contenido solamente revelable a la autoridad sanitaria.', LHH)
  y = y + 1
  HR(); y = y + 2

  // ── 2. TABLA DE DATOS ────────────────────────────────────────
  const C1 = MG
  const C2 = MG + PW * 0.34
  const C3 = MG + PW * 0.665
  const CW = PW / 3
  const RH = 7.2

  N(true); S(7.5); TC(0)
  doc.text('Datos del Tatuador',                       C1 + CW / 2, y, { align: 'center' })
  doc.text('Datos del Cliente',                         C2 + CW / 2, y, { align: 'center' })
  doc.text('Datos Representante (para menor de edad)',  C3 + CW / 2, y, { align: 'center' })

  const tblTop = y - 4
  // tblH se calcula dinámicamente después de renderizar las filas
  DC(160)
  y = y + 3
  const tblRowsStartY = y

  // Ancho real de cada columna en mm (menos 2mm de padding)
  const COL_W = CW - 2

  const ROW = (l1: string, v1: string, l2: string, v2: string, lb: string, vb: string, l3: string, v3: string) => {
    // Dividir cada valor en líneas según el ancho real disponible
    N(false); S(8); TC(0)
    const lines1: string[] = doc.splitTextToSize(v1, COL_W)
    const lines2: string[] = doc.splitTextToSize(v2, lb ? COL_W * 0.6 : COL_W)
    const lines3: string[] = v3 ? doc.splitTextToSize(v3, COL_W) : []
    const maxLines = Math.max(lines1.length, lines2.length, lines3.length, 1)
    const rowH = 3.5 + maxLines * 3.0 + 1.5  // label + líneas + padding

    // Label
    N(true); S(6.5); TC(80)
    doc.text(l1, C1, y); doc.text(l2, C2, y)
    if (lb) doc.text(lb, C2 + COL_W * 0.62, y)
    doc.text(l3, C3, y)

    // Valores — línea por línea con avance fijo
    N(false); S(8); TC(0)
    const LH_ROW = 3.0
    let cy1 = y + 3, cy2 = y + 3, cy3 = y + 3
    for (let i = 0; i < lines1.length; i++) { doc.text(lines1[i], C1, cy1); cy1 += LH_ROW }
    for (let i = 0; i < lines2.length; i++) { doc.text(lines2[i], C2, cy2); cy2 += LH_ROW }
    if (vb) doc.text(tr(vb, 6), C2 + COL_W * 0.62, y + 3)
    for (let i = 0; i < lines3.length; i++) { doc.text(lines3[i], C3, cy3); cy3 += LH_ROW }

    y = y + rowH
  }

  const tutN = r.menor && r.tutor?.nombre     ? r.tutor.nombre     : ''
  const tutR = r.menor && r.tutor?.rut        ? r.tutor.rut        : ''
  const tutT = r.menor && r.tutor?.telefono   ? r.tutor.telefono   : ''
  const tutP = r.menor && r.tutor?.parentesco ? r.tutor.parentesco : ''
  const tutD = r.menor && r.tutor?.direccion  ? r.tutor.direccion  : ''

  ROW('Nombre:', tatNombre, 'Nombre:', r.nombre, '', '', 'Nombre:', tutN)
  ROW('Rut:', tatRut, 'Rut:', r.rut, '', '', 'Rut:', tutR)
  ROW('Fecha nacimiento:', tatNac, 'Fecha de nacimiento:', r.nacimiento ?? '—', 'Edad:', r.edad ? String(r.edad) : '—', 'Fecha nacimiento:', tutP)
  ROW('Teléfono:', tatTel, 'Teléfono:', r.telefono ?? '—', '', '', 'Teléfono:', tutT)

  N(true); S(6.5); TC(80)
  doc.text('Lugar de ejecución:', C1, y)
  doc.text('Dirección:', C2, y)
  if (tutD) doc.text('Dirección:', C3, y)
  N(false); S(7.5); TC(0)
  doc.text('Estudio Okami - Rosal 377, dpto C. Santiago', C1, y + 3)
  // Dirección cliente — splitTextToSize para no truncar
  const dirLines: string[] = doc.splitTextToSize(r.direccion ?? '—', COL_W)
  let dirY = y + 3
  for (let i = 0; i < dirLines.length; i++) { doc.text(dirLines[i], C2, dirY); dirY += 3.0 }
  if (tutD) {
    const tutDLines: string[] = doc.splitTextToSize(tutD, COL_W)
    let tutDY = y + 3
    for (let i = 0; i < tutDLines.length; i++) { doc.text(tutDLines[i], C3, tutDY); tutDY += 3.0 }
  }
  const maxDirLines = Math.max(dirLines.length, tutD ? doc.splitTextToSize(tutD, COL_W).length : 1)
  y = y + 3.5 + maxDirLines * 3.0 + 1.5

  // Dibujar líneas verticales de la tabla ahora que sabemos la altura real
  DC(160)
  doc.line(C2, tblTop, C2, y)
  doc.line(C3, tblTop, C3, y)

  HR(); y = y + 2

  // ── 3. DATOS DEL TRABAJO ─────────────────────────────────────
  N(true); S(8); TC(0)
  doc.text('Datos del Trabajo a realizar', MID, y, { align: 'center' }); y = y + 4

  const CX  = MG + PW / 2 + 3
  const hw  = PW / 2 - 5

  N(true); S(6.5); TC(60)
  doc.text('Descripción', MG, y); doc.text('Zona del cuerpo:', CX, y)
  N(false); S(8); TC(0)
  doc.text(tr(r.descripcion ?? '—', 60), MG, y + 3)
  doc.text(tr(r.zona ?? '—', 38), CX, y + 3)
  y = y + 8

  N(true); S(6.5); TC(60)
  doc.text('Condiciones médicas y otros comentarios', MG, y)
  doc.text('Tipo de tatuaje', CX, y)
  N(false); S(8); TC(0)
  const cl: string[] = doc.splitTextToSize(r.condiciones_medicas ?? '—', hw)
  let cy2 = y + 3
  for (let i = 0; i < Math.min(cl.length, 2); i++) {
    doc.text(cl[i], MG, cy2)
    cy2 = cy2 + LH
  }
  doc.text(tr(r.tipo_tatuaje ?? '—', 38), CX, y + 3)
  y = y + (cl.length > 1 ? 11 : 8)

  HR(); y = y + 2

  // ── 4. SECCIONES ─────────────────────────────────────────────

  SEC('Características y complicaciones del tatuaje')
  IT('Es una decoración de la piel que puede ser de por vida; se realiza a través de una herida en la que se inyecta tinta de colores.')
  IT('Genera cambios permanentes, tanto por el tatuaje en sí como cambios por la exposición al sol, de la vida, o falta de cuidado del tatuaje.')
  IT('Hacerse un tatuaje puede ser doloroso y no está exento de riesgos. Sus consecuencias pueden ser permanentes, tales como: Reacciones alérgicas, Dermatitis, Reacciones a un cuerpo extraño (tinta), Insensibilidad de la zona, Infecciones de virus y bacterias.')
  IT('Para retirarlo se requiere de un procedimiento de varias sesiones. Este procedimiento puede ser doloroso y puede no borrar del todo el tatuaje.')
  IT('El procedimiento es exigente para el cuerpo, y en algunas personas puede producir náuseas, desmayos y malestar general. Es importante que el cliente esté alimentado, en buen estado de salud y con buen descanso previo para prevenir esta clase de malestar.')
  IT('Algunos pigmentos, principalmente el rojo, pueden generar alergias en un porcentaje bajo de la población. Esto puede resultar en irritación, sarpullido, y otros resultantes de una reacción alérgica. Es importante que sepas si tienes reacción a alguna tinta, sobre todo si eres propenso a las reacciones alérgicas.')
  HR(); y = y + 2

  SEC('No debieras tatuarte si:')
  IT('No estás 100% seguro(a) o no cuentas con toda la información necesaria de los riesgos.')
  IT('Eres menor de edad y no cuentas con la autorización de tu padre, madre o responsable legal.')
  IT('Tienes contraindicaciones médicas.')
  IT('Estás embarazada o crees que puedas estarlo, o en período de lactancia.')
  IT('Tienes problemas de salud sobre: Alergias, diabetes, enfermedad cardíaca, alguna infección, enfermedades de la piel, acné, trombopenia o hemofilia, problemas de cicatrización y/o coagulación, vitíligo o psoriasis, predisposición a generar queloides o enfermedades del sistema inmunológico, sin autorización médica.')
  IT('Has estado expuesto al sol o has consumido alcohol o estupefacientes en las últimas 24 horas.')
  HR(); y = y + 2

  SEC('Cuidados posteriores de un tatuaje')
  IT('No te maquilles en la zona donde recién se ha colocado el tatuaje.')
  IT('No expongas el tatuaje durante la cicatrización a: Suciedad, agua de piscina, río, mar u otro.')
  IT('Lávate las manos antes de tocar el tatuaje: en esa zona hay una herida.')
  IT('Los tiempos de cicatrización pueden ir desde 4 semanas hasta los 9 meses, según la zona del cuerpo.')
  HR(); y = y + 2

  SEC('Toma de conocimiento. Comprendo que:')
  IT('Este servicio consiste en la inserción de un pigmento con colorantes e ingredientes auxiliares insolubles, vía inyección directa con aguja, quedando un dibujo indeleble en la piel.')
  IT('Si no vengo en buen estado de salud, con horas de sueño y bien alimentado, soy propenso a sufrir malestar general, náuseas y hasta desmayos en el procedimiento.')
  IT('Dada la naturaleza de la piel, el servicio de tatuaje no es una reproducción exacta del diseño acordado, sino una aproximación que variará según la condición de la piel, el lugar del cuerpo, el movimiento del cliente durante la ejecución, el tono y morfología de la piel, y su evolución con los años.')
  IT('En el caso de querer cubrir un tatuaje anterior con un diseño nuevo, esto es un "Tatuaje Cover" que busca disimular un diseño existente y no lo borra, por lo que puede seguir notándose parcialmente el anterior, incluso si el nuevo diseño cubriera totalmente el diseño anterior.')
  IT('Acepto que de requerir tatuarme en una zona privada, mi tatuador tomará todas las medidas razonables para resguardar la privacidad del cliente, pero que por la dinámica del espacio compartido y la presencia de otros tatuadores y clientes, no se puede garantizar aislamiento total.')
  IT('Mi tatuador me informará de los cuidados posteriores a la realización del tatuaje una vez terminada la sesión.')
  IT('Este servicio conlleva un riesgo de infección local de la zona donde se aplica el pigmento, si no cumplo con el programa de cuidado indicado por el tatuador.')
  IT('Entiendo que como consecuencia de lo anterior, pueden darse resultados estéticos distintos al diseño, por la naturaleza biológica del procedimiento.')
  IT('Debo consultar un médico en caso de tener enfermedad base, dudas respecto a mi salud y/o si tengo complicaciones posteriores.')
  IT('Soy consciente y responsable de mis actos y me comprometo a realizar los cuidados posteriores que se me indiquen para el cuidado de la herida y prevenir dificultades posteriores.')
  IT('Se pueden producir complicaciones tanto por el cuidado incorrecto como por haberme realizado la práctica aun cuando este se encontrase contraindicado según se expresa en el presente documento.')
  IT('El rol del local donde me encuentro, "Estudio Okami" es y se limita a facilitar espacios aptos y en condiciones para la realización del tatuaje, y por consiguiente, será el tatuador individualizado en este documento responsable de todo lo relacionado con la planificación, ejecución, resultados y cobro del servicio de tatuajes que he solicitado, sin perjuicio de las obligaciones sanitarias que el establecimiento debe cumplir conforme al Decreto Supremo N° 304/2002.')

  // ── 5. AVISO + DECLARACIÓN ───────────────────────────────────
  HR(); y = y + 2
  N(false); S(7); TC(40)
  WC(
    'Esta información no supone la obligación de realizarme la práctica, pudiendo ser revocado en cualquier momento. ' +
    'De ser menor de edad, el procedimiento solo podrá realizarse con la presencia y firma del tutor legal del menor.',
    LHH
  )
  y = y + 1.5
  N(true); S(7.5); TC(0)
  doc.text('Mediante esta firma, tomo conocimiento de las implicancias del servicio señalado "Tatuaje" en mi persona.', MID, y, { align: 'center' })
  y = y + 4

  // ── 6. FIRMAS — posición fija al pie ─────────────────────────
  const FIRMA_H = 24
  const FY = PH - FIRMA_H - 3
  const fy = y > FY - 2 ? (doc.addPage(), MG + 6) : FY
  const FW = PW / 3

  DC(190)
  doc.line(MG + FW,     fy, MG + FW,     fy + FIRMA_H - 4)
  doc.line(MG + FW * 2, fy, MG + FW * 2, fy + FIRMA_H - 4)

  const firmas = [
    { lbl: 'Firma tatuador',            nom: tatNombre, rut: tatRut },
    { lbl: 'Firma Cliente',             nom: r.nombre,  rut: r.rut  },
    { lbl: 'Firma representante legal', nom: r.tutor?.nombre ?? (r.menor ? '' : 'No aplica'), rut: r.tutor?.rut ?? '' },
  ]

  for (let i = 0; i < firmas.length; i++) {
    const f  = firmas[i]
    const x  = MG + i * FW
    const cx = x + FW / 2
    DC(0); doc.line(x + 4, fy + 8, x + FW - 4, fy + 8)
    N(false); S(7.5); TC(0)
    doc.text(f.lbl, cx, fy + 12, { align: 'center' })
    N(false); S(6.5)
    if (f.nom && f.nom !== 'No aplica') {
      TC(20)
      const txt = f.rut ? `${tr(f.nom, 36)}   ${f.rut}` : tr(f.nom, 42)
      doc.text(txt, cx, fy + 17, { align: 'center' })
    } else {
      TC(150); doc.text('No aplica', cx, fy + 17, { align: 'center' })
    }
  }

  N(false); S(6); TC(160)
  doc.text(
    `Folio: ${r.folio}  |  ${r.fecha_display ?? ''}  ${r.hora_display ?? ''}  |  Estudio Okami`,
    MID, PH - 3, { align: 'center' }
  )
}
