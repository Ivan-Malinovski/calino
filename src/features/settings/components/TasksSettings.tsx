import type { JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { useSettingsStore } from '@/store/settingsStore'
import { SettingsPageHeading } from './SettingsPageHeading'
import styles from './Settings.module.css'

export function TasksSettings({ searchControl }: { searchControl?: JSX.Element }): JSX.Element {
  const { t } = useTranslation('settings')
  const showTaskCalendarLabels = useSettingsStore((state) => state.showTaskCalendarLabels)
  const showSidebarTaskCalendarLabels = useSettingsStore(
    (state) => state.showSidebarTaskCalendarLabels
  )
  const updateSettings = useSettingsStore((state) => state.updateSettings)

  return (
    <section
      className={`${styles.section} ${styles.sectionActive}`}
      data-component="tasks-settings"
    >
      <SettingsPageHeading title={t('tasks.title')} searchControl={searchControl} />
      <div className={styles.group}>
        <div className={styles.groupLabel}>{t('tasks.display')}</div>
        {(
          [
            {
              key: 'showTaskCalendarLabels',
              setting: 'show-task-calendar-labels',
              checked: showTaskCalendarLabels,
            },
            {
              key: 'showSidebarTaskCalendarLabels',
              setting: 'show-sidebar-task-calendar-labels',
              checked: showSidebarTaskCalendarLabels,
            },
          ] as const
        ).map(({ key, setting, checked }) => (
          <div
            key={key}
            className={styles.row}
            data-component="setting-row"
            data-setting={setting}
            data-value={String(checked)}
          >
            <div className={styles.rowInfo}>
              <div className={styles.rowLabel}>{t(`tasks.${key}.label`)}</div>
              <div className={styles.rowDesc}>{t(`tasks.${key}.desc`)}</div>
            </div>
            <div className={styles.rowControl}>
              <label className={styles.toggle} data-component="toggle" data-setting={setting}>
                <input
                  type="checkbox"
                  checked={checked}
                  aria-label={t(`tasks.${key}.label`)}
                  onChange={() => updateSettings({ [key]: !checked })}
                />
                <span className={styles.pill} />
                <span className={styles.knob} />
              </label>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
