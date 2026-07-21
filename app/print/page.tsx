'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import SoloRoles from '@/components/SoloRoles'

// Hoja tamaño Carta (Letter) en centímetros
const HOJA_W = 21.59
const HOJA_H = 27.94
const MIN_CM = 1
const MAX_IMGS = 3
const MAX_PX = 2400   // lado máximo tras normalizar (memoria + peso del PDF)

interface Img {
  id: string
  src: string
  formato: 'PNG' | 'JPEG'
  natW: number      // px naturales (para mantener proporción)
  natH: number
  xCm: number       // esquina superior izquierda, en cm (sobre el lienzo)
  yCm: number
  wCm: number       // ancho en cm (el alto se deriva de la proporción)
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}

function altoCm(img: Img): number {
  return img.wCm * img.natH / img.natW
}

// Grilla de hojas según cantidad y eje.
//  eje 'largo'  → hojas verticales (21,59 × 27,94)
//  eje 'corto'  → hojas horizontales (27,94 × 21,59)
//  2 → 2×1 · 3 → 3×1 · 4 → 2×2
function grillaDe(n: number, eje: 'largo' | 'corto') {
  const cols = n === 4 ? 2 : n
  const rows = n === 4 ? 2 : 1
  const hojaW = eje === 'largo' ? HOJA_W : HOJA_H
  const hojaH = eje === 'largo' ? HOJA_H : HOJA_W
  return { cols, rows, hojaW, hojaH, canvasW: cols * hojaW, canvasH: rows * hojaH }
}

// Normaliza la imagen: aplica la orientación EXIF de la cámara y la
// vuelve a dibujar en un canvas, de modo que los píxeles y sus
// dimensiones siempre coincidan (así no se deforma en pantalla ni en el
// PDF). Los PNG conservan su transparencia; el resto se guarda como JPEG.
async function normalizarImagen(file: File): Promise<{
  src: string; w: number; h: number; formato: 'PNG' | 'JPEG'
}> {
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    bitmap = await createImageBitmap(file)
  }
  let w = bitmap.width, h = bitmap.height
  if (Math.max(w, h) > MAX_PX) {
    const r = MAX_PX / Math.max(w, h)
    w = Math.round(w * r); h = Math.round(h * r)
  }
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('sin canvas')
  ctx.drawImage(bitmap, 0, 0, w, h)
  if (bitmap.close) bitmap.close()
  const esPng = file.type === 'image/png'
  return {
    src: canvas.toDataURL(esPng ? 'image/png' : 'image/jpeg', 0.92),
    w, h,
    formato: esPng ? 'PNG' : 'JPEG',
  }
}

function cargarImg(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const im = new Image()
    im.onload = () => resolve(im)
    im.onerror = reject
    im.src = src
  })
}

// Rota los píxeles 90° (izq/der) y devuelve el nuevo src + dimensiones.
// "Hornea" la transformación para que placement y PDF sigan siendo simples.
async function rotarImagen(img: Img, dir: 'izq' | 'der'): Promise<Partial<Img>> {
  const el = await cargarImg(img.src)
  const canvas = document.createElement('canvas')
  canvas.width = img.natH   // dimensiones intercambiadas
  canvas.height = img.natW
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('sin canvas')
  ctx.translate(canvas.width / 2, canvas.height / 2)
  ctx.rotate(dir === 'der' ? Math.PI / 2 : -Math.PI / 2)
  ctx.drawImage(el, -img.natW / 2, -img.natH / 2)
  const esPng = img.formato === 'PNG'
  return {
    src: canvas.toDataURL(esPng ? 'image/png' : 'image/jpeg', 0.95),
    natW: img.natH, natH: img.natW,
    wCm: altoCm(img),   // el nuevo ancho = alto anterior (mismo tamaño físico)
  }
}

// Espeja horizontalmente (mismo tamaño y proporción).
async function espejarImagen(img: Img): Promise<Partial<Img>> {
  const el = await cargarImg(img.src)
  const canvas = document.createElement('canvas')
  canvas.width = img.natW
  canvas.height = img.natH
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('sin canvas')
  ctx.translate(canvas.width, 0)
  ctx.scale(-1, 1)
  ctx.drawImage(el, 0, 0)
  const esPng = img.formato === 'PNG'
  return { src: canvas.toDataURL(esPng ? 'image/png' : 'image/jpeg', 0.95) }
}

// ── Íconos (rotar izq / rotar der / espejar) ──
function IcoRotarIzq() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
    </svg>
  )
}
function IcoRotarDer() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    </svg>
  )
}
function IcoEspejar() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3" />
      <path d="M16 3h3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-3" />
      <line x1="12" y1="2" x2="12" y2="22" strokeDasharray="3 3" />
    </svg>
  )
}

function PrintTool() {
  const [tab, setTab] = useState<'simple' | 'multi'>('simple')
  const [nHojas, setNHojas] = useState(2)
  const [eje, setEje] = useState<'largo' | 'corto'>('largo')

  const [imgs, setImgs] = useState<Img[]>([])
  const [sel, setSel] = useState<string | null>(null)
  const [scale, setScale] = useState(0)   // px por cm en pantalla
  const [generando, setGenerando] = useState(false)

  const sheetRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const dragRef = useRef<{
    id: string; mode: 'move' | 'resize'
    px: number; py: number
    x0: number; y0: number; w0: number
  } | null>(null)

  // Dimensiones del lienzo según pestaña/configuración
  const grid = tab === 'multi'
    ? grillaDe(nHojas, eje)
    : { cols: 1, rows: 1, hojaW: HOJA_W, hojaH: HOJA_H, canvasW: HOJA_W, canvasH: HOJA_H }
  const { canvasW, canvasH } = grid

  // Ref con las dimensiones actuales (para los manejadores de puntero)
  const dimsRef = useRef({ canvasW, canvasH })
  dimsRef.current = { canvasW, canvasH }

  // Medir el ancho real del lienzo en pantalla → px por cm
  useEffect(() => {
    const el = sheetRef.current
    if (!el) return
    const medir = () => setScale(el.clientWidth / dimsRef.current.canvasW)
    medir()
    const ro = new ResizeObserver(medir)
    ro.observe(el)
    return () => ro.disconnect()
  }, [canvasW, canvasH])

  // Al cambiar el lienzo, reencajar las imágenes para que no queden fuera
  useEffect(() => {
    setImgs(prev => prev.map(img => encajar(img, canvasW, canvasH)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasW, canvasH])

  function encajar(img: Img, cw: number, ch: number): Img {
    let wCm = Math.min(img.wCm, cw)
    let h = wCm * img.natH / img.natW
    if (h > ch) { wCm = ch * img.natW / img.natH; h = ch }
    return {
      ...img, wCm,
      xCm: clamp(img.xCm, 0, cw - wCm),
      yCm: clamp(img.yCm, 0, ch - h),
    }
  }

  // ── Subir imágenes ──
  async function onArchivos(files: FileList | null) {
    if (!files) return
    const cupos = MAX_IMGS - imgs.length
    if (cupos <= 0) { alert(`Puedes agregar hasta ${MAX_IMGS} imágenes.`); return }
    const seleccion = Array.from(files).slice(0, cupos)
    const { hojaW, hojaH } = grid
    for (let i = 0; i < seleccion.length; i++) {
      try {
        const norm = await normalizarImagen(seleccion[i])
        const id = `${Date.now()}-${i}-${Math.random().toString(36).slice(2, 7)}`
        setImgs(prev => {
          if (prev.length >= MAX_IMGS) return prev
          // Ancho por defecto: hasta 8 cm, sin salirse de una hoja
          let wCm = Math.min(8, hojaW - 2)
          if (wCm * norm.h / norm.w > hojaH - 2) {
            wCm = (hojaH - 2) * norm.w / norm.h
          }
          const off = 1 + prev.length * 1.2
          const nueva: Img = {
            id, src: norm.src, formato: norm.formato,
            natW: norm.w, natH: norm.h,
            xCm: clamp(off, 0, canvasW - wCm),
            yCm: clamp(off, 0, canvasH - wCm * norm.h / norm.w),
            wCm,
          }
          return [...prev, nueva]
        })
        setSel(id)
      } catch {
        alert('No se pudo procesar la imagen.')
      }
    }
    if (fileRef.current) fileRef.current.value = ''
  }

  function eliminar(id: string) {
    setImgs(prev => prev.filter(i => i.id !== id))
    if (sel === id) setSel(null)
  }

  function traerAlFrente(id: string) {
    setImgs(prev => {
      const found = prev.find(i => i.id === id)
      if (!found) return prev
      return [...prev.filter(i => i.id !== id), found]
    })
  }

  function cambiarAncho(id: string, wCm: number) {
    setImgs(prev => prev.map(img => {
      if (img.id !== id) return img
      const maxW = Math.min(canvasW - img.xCm, (canvasH - img.yCm) * img.natW / img.natH)
      return { ...img, wCm: clamp(wCm, MIN_CM, maxW) }
    }))
  }

  async function transformar(id: string, fn: (img: Img) => Promise<Partial<Img>>) {
    const img = imgs.find(i => i.id === id)
    if (!img) return
    try {
      const cambios = await fn(img)
      setImgs(prev => prev.map(x => x.id === id
        ? encajar({ ...x, ...cambios }, dimsRef.current.canvasW, dimsRef.current.canvasH)
        : x))
    } catch {
      alert('No se pudo transformar la imagen.')
    }
  }

  // ── Arrastrar / redimensionar (mouse y táctil) ──
  const onPointerMove = useCallback((e: PointerEvent) => {
    const d = dragRef.current
    if (!d || scale <= 0) return
    const { canvasW: cw, canvasH: ch } = dimsRef.current
    const dxCm = (e.clientX - d.px) / scale
    const dyCm = (e.clientY - d.py) / scale
    setImgs(prev => prev.map(img => {
      if (img.id !== d.id) return img
      if (d.mode === 'move') {
        const h = altoCm(img)
        return {
          ...img,
          xCm: clamp(d.x0 + dxCm, 0, cw - img.wCm),
          yCm: clamp(d.y0 + dyCm, 0, ch - h),
        }
      }
      const maxW = Math.min(cw - img.xCm, (ch - img.yCm) * img.natW / img.natH)
      return { ...img, wCm: clamp(d.w0 + dxCm, MIN_CM, maxW) }
    }))
  }, [scale])

  const onPointerUp = useCallback(() => {
    dragRef.current = null
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)
  }, [onPointerMove])

  function iniciar(e: React.PointerEvent, img: Img, mode: 'move' | 'resize') {
    e.preventDefault()
    e.stopPropagation()
    setSel(img.id)
    traerAlFrente(img.id)
    dragRef.current = {
      id: img.id, mode,
      px: e.clientX, py: e.clientY,
      x0: img.xCm, y0: img.yCm, w0: img.wCm,
    }
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
  }

  useEffect(() => () => {
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)
  }, [onPointerMove, onPointerUp])

  // ── Descargar PDF: una página por hoja; el diseño se reparte entre
  //    ellas para que al imprimir y unirlas físicamente se reconstruya. ──
  async function descargarPDF() {
    if (imgs.length === 0) return
    setGenerando(true)
    try {
      const { jsPDF } = await import('jspdf')
      const { cols, rows, hojaW, hojaH } = grid
      const doc = new jsPDF({ unit: 'cm', format: [hojaW, hojaH], orientation: hojaW > hojaH ? 'landscape' : 'portrait' })
      let primera = true
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (!primera) doc.addPage([hojaW, hojaH], hojaW > hojaH ? 'landscape' : 'portrait')
          primera = false
          const offX = c * hojaW, offY = r * hojaH
          // Cada imagen se dibuja desplazada; el borde de la página recorta
          imgs.forEach(img => {
            doc.addImage(img.src, img.formato, img.xCm - offX, img.yCm - offY, img.wCm, altoCm(img))
          })
        }
      }
      doc.save(tab === 'multi' ? `diseno-okami-${nHojas}hojas.pdf` : 'diseno-okami.pdf')
    } finally {
      setGenerando(false)
    }
  }

  const seleccionada = imgs.find(i => i.id === sel) ?? null

  // Celdas (hojas) para dibujar los bordes/costuras
  const celdas: { r: number; c: number }[] = []
  for (let r = 0; r < grid.rows; r++) for (let c = 0; c < grid.cols; c++) celdas.push({ r, c })

  // El lienzo apaisado necesita más ancho en pantalla
  const maxAncho = canvasW >= canvasH ? 720 : 460

  return (
    <div>
      <h1 style={{ marginBottom: 4 }}>Tattoo Print Tool</h1>
      <p style={{ color: 'var(--text2)', fontSize: '0.9rem', maxWidth: 660, marginBottom: 14 }}>
        Sube tu diseño y ubícalo sobre la hoja tamaño Carta. Ajusta el tamaño viendo
        los centímetros exactos y descarga un PDF listo para imprimir.
        <strong> Al imprimir, elige &quot;Tamaño real&quot; o &quot;100%&quot; (sin ajustar a la página)</strong> —
        el PDF ya tiene el tamaño de la hoja, así que sale exacto.
      </p>

      {/* Pestañas */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button className={`chico ${tab === 'simple' ? '' : 'secundario'}`}
          onClick={() => { setTab('simple'); setSel(null) }}>Hoja simple</button>
        <button className={`chico ${tab === 'multi' ? '' : 'secundario'}`}
          onClick={() => { setTab('multi'); setSel(null) }}>Multi hoja</button>
      </div>

      {/* Controles de multi hoja */}
      {tab === 'multi' && (
        <div className="card" style={{ marginBottom: 14, display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ fontSize: '0.82rem', color: 'var(--text2)', marginRight: 4 }}>Hojas:</span>
            {[2, 3, 4].map(n => (
              <button key={n} className={`chico ${nHojas === n ? '' : 'secundario'}`}
                onClick={() => setNHojas(n)}>{n} hojas</button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ fontSize: '0.82rem', color: 'var(--text2)', marginRight: 4 }}>Orientación:</span>
            <button className={`chico ${eje === 'largo' ? '' : 'secundario'}`}
              onClick={() => setEje('largo')}>Eje largo</button>
            <button className={`chico ${eje === 'corto' ? '' : 'secundario'}`}
              onClick={() => setEje('corto')}>Eje corto</button>
          </div>
          <span style={{ fontSize: '0.78rem', color: 'var(--text3)' }}>
            Total: {canvasW.toFixed(1)} × {canvasH.toFixed(1)} cm
          </span>
        </div>
      )}

      <div className="print-layout">
        {/* Lienzo (una o varias hojas) */}
        <div style={{ flex: '1 1 320px', minWidth: 0, overflowX: 'auto' }}>
          <div
            ref={sheetRef}
            className="hoja-carta"
            onPointerDown={() => setSel(null)}
            style={{ aspectRatio: `${canvasW} / ${canvasH}`, maxWidth: maxAncho }}
          >
            {/* Hojas (bordes/costuras) */}
            {celdas.map(({ r, c }) => (
              <div key={`${r}-${c}`} style={{
                position: 'absolute',
                left: c * grid.hojaW * scale, top: r * grid.hojaH * scale,
                width: grid.hojaW * scale, height: grid.hojaH * scale,
                boxSizing: 'border-box',
                borderRight: c < grid.cols - 1 ? '1px dashed #b9b9b3' : 'none',
                borderBottom: r < grid.rows - 1 ? '1px dashed #b9b9b3' : 'none',
                pointerEvents: 'none',
              }}>
                {tab === 'multi' && (
                  <span style={{
                    position: 'absolute', top: 3, left: 4, fontSize: 10,
                    color: '#c9c9c2', fontWeight: 600,
                  }}>Hoja {r * grid.cols + c + 1}</span>
                )}
              </div>
            ))}

            {/* Imágenes */}
            {scale > 0 && imgs.map(img => {
              const activa = img.id === sel
              return (
                <div
                  key={img.id}
                  onPointerDown={e => iniciar(e, img, 'move')}
                  style={{
                    position: 'absolute',
                    left: img.xCm * scale,
                    top: img.yCm * scale,
                    width: img.wCm * scale,
                    height: altoCm(img) * scale,
                    touchAction: 'none',
                    cursor: 'move',
                    outline: activa ? '2px solid var(--accent)' : '1px dashed rgba(0,0,0,0.25)',
                    boxShadow: activa ? '0 0 0 1px #fff' : 'none',
                  }}
                >
                  <img src={img.src} alt="" draggable={false}
                    style={{ width: '100%', height: '100%', display: 'block', pointerEvents: 'none' }} />
                  {activa && (
                    <>
                      <span style={{
                        position: 'absolute', top: -20, left: 0,
                        background: 'var(--accent)', color: '#fff',
                        fontSize: 11, padding: '1px 6px', borderRadius: 4, whiteSpace: 'nowrap',
                      }}>
                        {img.wCm.toFixed(1)} × {altoCm(img).toFixed(1)} cm
                      </span>
                      <span
                        onPointerDown={e => iniciar(e, img, 'resize')}
                        style={{
                          position: 'absolute', right: -8, bottom: -8,
                          width: 18, height: 18, borderRadius: '50%',
                          background: 'var(--accent)', border: '2px solid #fff',
                          cursor: 'nwse-resize', touchAction: 'none',
                        }}
                      />
                    </>
                  )}
                </div>
              )
            })}
          </div>
          <p style={{ textAlign: 'center', color: 'var(--text3)', fontSize: '0.78rem', marginTop: 6 }}>
            {tab === 'multi'
              ? `${nHojas} hojas Carta · ${eje === 'largo' ? 'eje largo' : 'eje corto'} · ${canvasW.toFixed(1)} × ${canvasH.toFixed(1)} cm`
              : `Hoja Carta · ${HOJA_W} × ${HOJA_H} cm`}
          </p>
        </div>

        {/* Controles */}
        <div style={{ flex: '0 0 260px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="card">
            <div className="section-title">Imágenes ({imgs.length}/{MAX_IMGS})</div>
            <input ref={fileRef} type="file" accept="image/*" multiple
              style={{ display: 'none' }}
              onChange={e => onArchivos(e.target.files)} />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={imgs.length >= MAX_IMGS}
              style={{ width: '100%' }}
            >
              + Agregar imagen
            </button>

            {imgs.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12 }}>
                {imgs.map((img, i) => (
                  <div key={img.id}
                    onClick={() => { setSel(img.id); traerAlFrente(img.id) }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8, padding: 6, borderRadius: 8,
                      cursor: 'pointer',
                      border: `1px solid ${img.id === sel ? 'var(--accent)' : 'var(--border)'}`,
                      background: img.id === sel ? 'var(--accent-soft)' : 'var(--bg3)',
                    }}>
                    <img src={img.src} alt="" style={{ width: 34, height: 34, objectFit: 'contain', borderRadius: 4, background: '#fff' }} />
                    <span style={{ fontSize: '0.8rem', color: 'var(--text2)' }}>
                      Imagen {i + 1}<br />
                      <span style={{ color: 'var(--text3)' }}>{img.wCm.toFixed(1)} × {altoCm(img).toFixed(1)} cm</span>
                    </span>
                    <button className="chico secundario" style={{ marginLeft: 'auto', padding: '2px 8px' }}
                      onClick={e => { e.stopPropagation(); eliminar(img.id) }}>✕</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {seleccionada && (
            <div className="card">
              <div className="section-title">Imagen seleccionada</div>

              {/* Rotar / espejar */}
              <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                <button className="chico secundario" title="Rotar a la izquierda"
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, padding: '7px 0' }}
                  onClick={() => transformar(seleccionada.id, img => rotarImagen(img, 'izq'))}>
                  <IcoRotarIzq />
                </button>
                <button className="chico secundario" title="Rotar a la derecha"
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, padding: '7px 0' }}
                  onClick={() => transformar(seleccionada.id, img => rotarImagen(img, 'der'))}>
                  <IcoRotarDer />
                </button>
                <button className="chico secundario" title="Espejar (voltear horizontal)"
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, padding: '7px 0' }}
                  onClick={() => transformar(seleccionada.id, espejarImagen)}>
                  <IcoEspejar />
                </button>
              </div>

              <label style={{ fontSize: '0.82rem', color: 'var(--text2)' }}>
                Ancho: {seleccionada.wCm.toFixed(1)} cm · Alto: {altoCm(seleccionada).toFixed(1)} cm
              </label>
              <input
                type="range" min={MIN_CM} max={Math.round(canvasW)} step={0.1}
                value={seleccionada.wCm}
                onChange={e => cambiarAncho(seleccionada.id, Number(e.target.value))}
                style={{ width: '100%', marginTop: 8 }}
              />
              <p style={{ fontSize: '0.76rem', color: 'var(--text3)', marginTop: 6 }}>
                También puedes arrastrar la imagen y usar el punto de la esquina para escalar.
              </p>
            </div>
          )}

          <button onClick={descargarPDF} disabled={imgs.length === 0 || generando}>
            {generando ? 'Generando…' : tab === 'multi'
              ? `⬇ Descargar PDF (${nHojas} hojas)`
              : '⬇ Descargar PDF (Carta)'}
          </button>
          {tab === 'multi' && (
            <p style={{ fontSize: '0.76rem', color: 'var(--text3)', marginTop: -4 }}>
              El PDF trae una página por hoja. Imprímelas al 100% y únelas por los bordes punteados.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

export default function PrintToolProtegida() {
  return (
    <SoloRoles roles={['admin', 'host', 'tatuador']}>
      <PrintTool />
    </SoloRoles>
  )
}
