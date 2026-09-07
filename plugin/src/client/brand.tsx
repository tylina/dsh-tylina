import { IconWorld } from '@tabler/icons-react'
import type { Translate } from './locale'

export function TylinaBrand({ t }: { t: Translate }) {
  return <a className="tylina-dsh-brand" href="https://tylina.github.io/" target="_blank" rel="noopener noreferrer"
    title={t('website')} aria-label={t('website')}>
    <strong>Tylina</strong>
  </a>
}
export function WebEditorLink({ t }: { t: Translate }) {
  return <a className="tylina-dsh-icon-link" href="https://tylina.github.io/app/" target="_blank" rel="noopener noreferrer"
    title={t('webEditor')} aria-label={t('webEditor')}><IconWorld size={16} /></a>
}
