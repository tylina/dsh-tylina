import { useEffect, useLayoutEffect, useRef, useState } from 'react'

const widthKey = 'tylina.dsh.panelWidth'
export function panelWidth(preferred: number, viewport: number): number {
  // A phone uses one surface at a time. Desktop keeps an operable conversation beside the document.
  return viewport < 900 ? viewport : Math.round(Math.max(420, Math.min(viewport - 380, preferred)))
}

/** Reserve viewport space without replacing Harness slots or reaching into its private React DOM. */
export function useDocumentDock(visible: boolean) {
  const [viewport, setViewport] = useState(window.innerWidth)
  const [preferred, setPreferred] = useState(() => {
    try { const value = Number(localStorage.getItem(widthKey)); if (value >= 420) return value } catch { /* Optional preference. */ }
    return Math.round(window.innerWidth * .56)
  })
  const width = panelWidth(preferred, viewport)
  useEffect(() => {
    const resize = () => setViewport(window.innerWidth)
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])
  useLayoutEffect(() => {
    if (!visible) return
    const body = document.body
    body.setAttribute('data-tylina-docked', '')
    body.style.setProperty('--tylina-dock-width', `${width}px`)
    return () => { body.removeAttribute('data-tylina-docked'); body.style.removeProperty('--tylina-dock-width') }
  }, [visible, width])
  useLayoutEffect(() => {
    if (!visible || viewport >= 900) return
    const siblings = [...document.body.children].filter((element): element is HTMLElement =>
      element instanceof HTMLElement && !element.classList.contains('tylina-dsh-panel'))
    const previous = siblings.map((element) => element.inert)
    siblings.forEach((element) => { element.inert = true })
    return () => siblings.forEach((element, index) => { element.inert = previous[index]! })
  }, [visible, viewport])
  const update = (next: number) => {
    const value = panelWidth(next, window.innerWidth)
    setPreferred(value)
    try { localStorage.setItem(widthKey, String(value)) } catch { /* Optional preference. */ }
  }
  return { width, update, narrow: viewport < 900 }
}

export function DockResize({ width, update, label }: { width: number; update(value: number): void; label: string }) {
  const [dragging, setDragging] = useState(false)
  const start = useRef<{ x: number; width: number; pointerId: number } | null>(null)
  const updateRef = useRef(update)
  updateRef.current = update
  useEffect(() => {
    const move = (event: PointerEvent) => {
      const drag = start.current
      if (drag?.pointerId === event.pointerId) updateRef.current(drag.width + drag.x - event.clientX)
    }
    const end = () => { start.current = null; setDragging(false) }
    const up = (event: PointerEvent) => { move(event); end() }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', end)
    window.addEventListener('blur', end)
    return () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', end); window.removeEventListener('blur', end)
    }
  }, [])
  return <>
    {dragging && <div className="tylina-dsh-drag-shield" />}
    <div className="tylina-dsh-resize" role="separator" aria-label={label} aria-orientation="vertical"
      aria-valuemin={420} aria-valuemax={window.innerWidth - 380} aria-valuenow={width} tabIndex={0}
      onKeyDown={(event) => {
        const next = event.key === 'ArrowLeft' ? width + 32 : event.key === 'ArrowRight' ? width - 32
          : event.key === 'Home' ? 420 : event.key === 'End' ? window.innerWidth - 380 : undefined
        if (next !== undefined) { event.preventDefault(); update(next) }
      }}
      onPointerDown={(event) => {
        event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId)
        start.current = { x: event.clientX, width, pointerId: event.pointerId }; setDragging(true)
      }} />
  </>
}
