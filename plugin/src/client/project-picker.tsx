import { useState } from 'react'
import { IconArrowRight, IconBrowser, IconChevronDown, IconChevronRight, IconExternalLink, IconFolder } from '@tabler/icons-react'
import type { Translate } from './locale'

interface Props {
  t: Translate
  sessions: Array<{ id: string; title: string; cwd?: string }>
  selectedId: string
  project: string
  busy: boolean
  canCancel: boolean
  onSelect(id: string): void
  onProject(value: string): void
  onOpen(): void
  onCancel(): void
  onCreate(): void
}

export function ProjectPicker({ t, sessions, selectedId, project, busy, canCancel,
  onSelect, onProject, onOpen, onCancel, onCreate }: Props) {
  const [advanced, setAdvanced] = useState(Boolean(project))
  const cwd = sessions.find((session) => session.id === selectedId)?.cwd
  return <form className="tylina-dsh-project" onSubmit={(event) => { event.preventDefault(); onOpen() }}>
    <div className="tylina-dsh-project-heading">
      <a href="https://tylina.github.io/" target="_blank" rel="noopener noreferrer" title={t('website')} aria-label={t('website')}>
        <img src="/tylina/favicon.svg" width="36" height="36" alt="" />
      </a>
      <div><h2>{t('choose')}</h2><p>{t('hint')}</p></div>
    </div>
    {sessions.length ? <>
      <label className="tylina-dsh-field">{t('session')}
        <span className="tylina-dsh-select">
          <select value={selectedId} disabled={busy} onChange={(event) => {
            onSelect(event.target.value); onProject(''); setAdvanced(false)
          }}>
            <option value="" disabled>{t('session')}</option>
            {sessions.map((session) => <option key={session.id} value={session.id}>{session.title}</option>)}
          </select>
          <IconChevronDown size={14} aria-hidden="true" />
        </span>
      </label>
      {cwd && <div className="tylina-dsh-directory"><IconFolder size={14} aria-hidden="true" /><span title={cwd}>{cwd}</span></div>}
      <button className="tylina-dsh-subfolder" type="button" aria-expanded={advanced}
        aria-controls="tylina-dsh-subfolder" onClick={() => setAdvanced(!advanced)}>
        <IconChevronRight size={14} aria-hidden="true" />{project && !advanced ? project : t('subfolder')}
      </button>
      {advanced && <label id="tylina-dsh-subfolder" className="tylina-dsh-field">{t('directory')}
        <input value={project} disabled={busy} placeholder="papers/report" spellCheck={false}
          onChange={(event) => onProject(event.target.value)} />
      </label>}
      <div className="tylina-dsh-project-actions">
        {canCancel && <button type="button" disabled={busy} onClick={onCancel}>{t('cancel')}</button>}
        <button className="tylina-dsh-primary" type="submit" disabled={busy || !selectedId} aria-busy={busy}>
          {busy ? t('loading') : t('submit')}<IconArrowRight size={16} aria-hidden="true" />
        </button>
      </div>
    </> : <div className="tylina-dsh-empty-project">
      <p>{t('noSession')}</p><button type="button" className="tylina-dsh-primary" disabled={busy} onClick={onCreate}>
        {t('create')}<IconArrowRight size={16} aria-hidden="true" />
      </button>
    </div>}
    <div className="tylina-dsh-project-footer"><a href="/tylina/" target="_blank" rel="noopener noreferrer">
      <IconBrowser size={15} aria-hidden="true" />{t('drafts')}<IconExternalLink size={13} aria-hidden="true" />
    </a></div>
  </form>
}
