import { useEffect, useRef, useState } from 'react'
import type { HarnessDocument } from './document'

/** Only the connection control waits; document input remains available while old calls settle. */
export function useToolReconnect(document: () => HarnessDocument | undefined, report: (error: Error) => void) {
  const [busy, setBusy] = useState(false)
  const active = useRef(false), alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  return { busy, reconnect() {
    const current = document()
    if (!current || active.current) return
    active.current = true; setBusy(true)
    void current.reconnectTools().catch((error) => {
      if (alive.current) report(error instanceof Error ? error : new Error(String(error)))
    }).finally(() => { active.current = false; if (alive.current) setBusy(false) })
  } }
}
