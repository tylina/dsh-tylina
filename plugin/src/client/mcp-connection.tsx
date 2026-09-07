import { useEffect, useRef, useState } from 'react'
import { IconCheck, IconCopy, IconPlugConnected, IconX } from '@tabler/icons-react'
import type { HarnessDocument } from './document'
import type { Translate } from './locale'

/** Configuration is copied only on request; its scoped secret never enters preferences or the document. */
export function McpConnectionButton({ getDocument, t, disabled }: {
  getDocument(): HarnessDocument | undefined; t: Translate; disabled?: boolean
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [open, setOpen] = useState(false), [copied, setCopied] = useState(false), [error, setError] = useState<string>()
  useEffect(() => { if (open) dialog.current?.showModal() }, [open])
  const copy = async () => {
    setError(undefined); setCopied(false)
    try {
      const doc = getDocument()
      if (!doc) throw new Error(t('noSession'))
      await navigator.clipboard.writeText(JSON.stringify(doc.mcpConfiguration(), null, 2))
      setCopied(true)
    } catch (error) { setError(error instanceof Error ? error.message : String(error)) }
  }
  return <>
    <button type="button" title={t('mcp')} aria-label={t('mcp')} disabled={disabled}
      onClick={() => { setCopied(false); setError(undefined); setOpen(true) }}><IconPlugConnected size={16} /></button>
    {open && <dialog ref={dialog} className="tylina-dsh-mcp" aria-labelledby="tylina-mcp-title" aria-describedby="tylina-mcp-hint"
      onClose={() => setOpen(false)} onKeyDown={(event) => { if (event.key === 'Escape') event.stopPropagation() }}>
      <div className="tylina-dsh-mcp-heading"><strong id="tylina-mcp-title">{t('mcp')}</strong>
        <button type="button" aria-label={t('dismiss')} onClick={() => dialog.current?.close()}><IconX size={16} /></button></div>
      <p id="tylina-mcp-hint">{t('mcpHint')}</p>
      <p>{t('mcpExpiry')}</p>
      {error && <p role="alert">{error}</p>}
      <button type="button" className="tylina-dsh-mcp-copy" aria-label={t('copyMcp')} onClick={() => { void copy() }}>
        {copied ? <IconCheck size={16} aria-hidden /> : <IconCopy size={16} aria-hidden />}<span role="status">{t(copied ? 'copied' : 'copyMcp')}</span>
      </button>
    </dialog>}
  </>
}
