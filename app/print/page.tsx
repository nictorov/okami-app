'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import SoloRoles from '@/components/SoloRoles'

// Hoja tamaño Carta (Letter) en centímetros
const HOJA_W = 21.59
const HOJA_H = 27.94
const MIN_CM = 1
const MAX_IMGS = 3

interface Img {
  id: string
  src: string
  formato: 'PNG' | 'JPEG'
  natW: number      // px naturales (para mantener proporción)
  natH: number
  xCm: number       // esquina superior izquierda, en cm
  yCm: number
  wCm: number       // ancho en cm (el alto se deriva de la proporción)
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}

function altoCm(img: Img): number {
  return img.wCm * img.natH / img.natW
}

function PrintTool() {
  const [imgs, setImgs] = useState<Img[]>([])
  const [sel, setSel] = useState<string | null>(null)
  const [scale, setScale] = useState(0)   // px por cm de la hoja en pantalla
  const [generando, setGenerando] = useState(false)

  const sheetRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const dragRef = useRef<{
    id: string; mode: 'move' | 'resize'
    px: number; py: number
    x0: number; y0: number; w0: number
  } | null>(null)

  // Medir el ancho real de la hoja en pantalla → px por cm
  useEffect(() => {
    const el = sheetRef.current
    if (!el) return
    const medir = () => setScale(el.clientWidth / HOJA_W)
    medir()
    const ro = new ResizeObserver(medir)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // ── Subir imágenes ──
  function onArchivos(files: FileList | null) {
    if (!files) return
    const cupos = MAX_IMGS - imgs.length
    if (cupos <= 0) { alert(`Puedes agregar hasta ${MAX_IMGS} imágenes.`); return }
    const seleccion = Array.from(files).slice(0, cupos)
    seleccion.forEach((file, i) => {
      const reader = new FileReader()
      reader.onload = () => {
        const src = String(reader.result)
        const im = new Image()
        im.onload = () => {
          // Ancho por defecto: hasta 8 cm, sin salirse de la hoja
          let wCm = Math.min(8, HOJA_W - 2)
          if (wCm * im.height / im.width > HOJA_H - 2) {
            wCm = (HOJA_H - 2) * im.width / im.height
          }
          const off = 1 + (imgs.length + i) * 1.2
          const nueva: Img = {
            id: `${Date.now()}-${i}-${Math.random().toString(36).slice(2, 7)}`,
            src,
            formato: src.startsWith('data:image/png') ? 'PNG' : 'JPEG',
            natW: im.width, natH: im.height,
            xCm: clamp(off, 0, HOJA_W - wCm),
            yCm: clamp(off, 0, HOJA_H - wCm * im.height / im.width),
            wCm,
          }
          setImgs(prev => prev.length >= MAX_IMGS ? prev : [...prev, nueva])
          setSel(nueva.id)
        }
        im.src = src
      }
      reader.readAsDataURL(file)
    })
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
      const maxW = Math.min(HOJA_W - img.xCm, (HOJA_H - img.yCm) * img.natW / img.natH)
      return { ...img, wCm: clamp(wCm, MIN_CM, maxW) }
    }))
  }

  // ── Arrastrar / redimensionar (mouse y táctil) ──
  const onPointerMove = useCallback((e: PointerEvent) => {
    const d = dragRef.current
    if (!d || scale <= 0) return
    const dxCm = (e.clientX - d.px) / scale
    const dyCm = (e.clientY - d.py) / scale
    setImgs(prev => prev.map(img => {
      if (img.id !== d.id) return img
      if (d.mode === 'move') {
        const h = altoCm(img)
        return {
          ...img,
          xCm: clamp(d.x0 + dxCm, 0, HOJA_W - img.wCm),
          yCm: clamp(d.y0 + dyCm, 0, HOJA_H - h),
        }
      }
      const maxW = Math.min(HOJA_W - img.xCm, (HOJA_H - img.yCm) * img.natW / img.natH)
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

  // ── Descargar PDF tamaño Carta con las imágenes en su posición/tamaño ──
  async function descargarPDF() {
    if (imgs.length === 0) return
    setGenerando(true)
    try {
      const { jsPDF } = await import('jspdf')
      const doc = new jsPDF({ unit: 'cm', format: 'letter', orientation: 'portrait' })
      imgs.forEach(img => {
        doc.addImage(img.src, img.formato, img.xCm, img.yCm, img.wCm, altoCm(img))
      })
      doc.save('diseno-okami.pdf')
    } finally {
      setGenerando(false)
    }
  }

  const seleccionada = imgs.find(i => i.id === sel) ?? null

  return (
    <div>
      <h1 style={{ marginBottom: 4 }}>Tattoo Print Tool</h1>
      <p style={{ color: 'var(--text2)', fontSize: '0.9rem', maxWidth: 640, marginBottom: 18 }}>
        Sube tu diseño y ubícalo dentro de una hoja tamaño Carta. Ajusta el tamaño
        viendo los centímetros exactos y descarga un PDF listo para imprimir.
        <strong> Al imprimir, elige "Tamaño real" o "100%" (sin ajustar a la página)</strong> —
        el PDF ya tiene el tamaño de la hoja, así que sale exacto.
      </p>

      <div className="print-layout">
        {/* Hoja */}
        <div style={{ flex: '1 1 320px', minWidth: 0 }}>
          <div
            ref={sheetRef}
            className="hoja-carta"
            onPointerDown={() => setSel(null)}
            style={{ aspectRatio: `${HOJA_W} / ${HOJA_H}` }}
          >
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
                      {/* Medida en cm */}
                      <span style={{
                        position: 'absolute', top: -20, left: 0,
                        background: 'var(--accent)', color: '#fff',
                        fontSize: 11, padding: '1px 6px', borderRadius: 4, whiteSpace: 'nowrap',
                      }}>
                        {img.wCm.toFixed(1)} × {altoCm(img).toFixed(1)} cm
                      </span>
                      {/* Handle de redimensión */}
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
            Hoja Carta · {HOJA_W} × {HOJA_H} cm
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
                    <img src={img.src} alt="" style={{ width: 34, height: 34, objectFit: 'cover', borderRadius: 4 }} />
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
              <div className="section-title">Tamaño (imagen seleccionada)</div>
              <label style={{ fontSize: '0.82rem', color: 'var(--text2)' }}>
                Ancho: {seleccionada.wCm.toFixed(1)} cm · Alto: {altoCm(seleccionada).toFixed(1)} cm
              </label>
              <input
                type="range" min={MIN_CM} max={HOJA_W} step={0.1}
                value={seleccionada.wCm}
                onChange={e => cambiarAncho(seleccionada.id, Number(e.target.value))}
                style={{ width: '100%', marginTop: 8 }}
              />
              <p style={{ fontSize: '0.76rem', color: 'var(--text3)', marginTop: 6 }}>
                También puedes arrastrar la imagen en la hoja y usar el punto de la esquina para escalar.
              </p>
            </div>
          )}

          <button onClick={descargarPDF} disabled={imgs.length === 0 || generando}>
            {generando ? 'Generando…' : '⬇ Descargar PDF (Carta)'}
          </button>
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
