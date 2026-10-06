import type { JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { Modal } from '@/components/common/Modal'
import styles from './ShortcutsHelp.module.css'

interface Shortcut {
  keys: string[]
  descriptionKey: string
}

interface ShortcutGroup {
  titleKey: string
  shortcuts: Shortcut[]
}

const GROUPS: ShortcutGroup[] = [
  {
    titleKey: 'ui.shortcuts.navigation',
    shortcuts: [
      { keys: ['T'], descriptionKey: 'ui.shortcuts.today' },
      { keys: ['<', ','], descriptionKey: 'ui.shortcuts.prevView' },
      { keys: ['>', '.'], descriptionKey: 'ui.shortcuts.nextView' },
    ],
  },
  {
    titleKey: 'ui.shortcuts.create',
    shortcuts: [
      { keys: ['C'], descriptionKey: 'ui.shortcuts.newEvent' },
      { keys: ['K'], descriptionKey: 'ui.shortcuts.newTask' },
      { keys: ['\u2318', 'K'], descriptionKey: 'ui.shortcuts.palette' },
    ],
  },
  {
    titleKey: 'ui.shortcuts.general',
    shortcuts: [
      { keys: ['?'], descriptionKey: 'ui.shortcuts.showHelp' },
      { keys: ['Esc'], descriptionKey: 'ui.shortcuts.closePanel' },
    ],
  },
]

interface ShortcutsHelpProps {
  isOpen: boolean
  onClose: () => void
}

export function ShortcutsHelp({ isOpen, onClose }: ShortcutsHelpProps): JSX.Element {
  const { t } = useTranslation('common')
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('ui.shortcuts.title')}
      className={styles.modal}
    >
      <div className={styles.body}>
        {GROUPS.map((group) => (
          <section key={group.titleKey} className={styles.group}>
            <h3 className={styles.groupTitle}>{t(group.titleKey)}</h3>
            <ul className={styles.list}>
              {group.shortcuts.map((s) => (
                <li key={s.descriptionKey} className={styles.row}>
                  <span className={styles.description}>{t(s.descriptionKey)}</span>
                  <span className={styles.keys}>
                    {s.keys.map((k, i) => (
                      <kbd key={i} className={styles.kbd}>
                        {k}
                      </kbd>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
        <p className={styles.hint}>{t('ui.shortcuts.disabledHint')}</p>
      </div>
    </Modal>
  )
}
