import type { JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { useSettingsStore } from '@/store/settingsStore'
import type { UserSettings } from '@/types'
import { SettingsPageHeading } from './SettingsPageHeading'
import styles from './Settings.module.css'

type TaskToggleKey =
  | 'showTaskCalendarLabels'
  | 'showSidebarTaskCalendarLabels'
  | 'hideCompletedTasks'
  | 'taskDueDateReminders'
  | 'overdueTaskBadge'

interface TaskToggle {
  /** Locale key under `tasks.` for the row's label and description. */
  key: TaskToggleKey
  /** `data-setting` value, kept stable for the e2e selectors. */
  setting: string
  checked: boolean
  update: Partial<UserSettings>
}

export function TasksSettings({ searchControl }: { searchControl?: JSX.Element }): JSX.Element {
  const { t } = useTranslation('settings')
  const showTaskCalendarLabels = useSettingsStore((state) => state.showTaskCalendarLabels)
  const showSidebarTaskCalendarLabels = useSettingsStore(
    (state) => state.showSidebarTaskCalendarLabels
  )
  const hideCompletedTasksInMonthView = useSettingsStore(
    (state) => state.hideCompletedTasksInMonthView
  )
  const taskDueDateReminders = useSettingsStore((state) => state.taskDueDateReminders)
  const overdueTaskBadge = useSettingsStore((state) => state.overdueTaskBadge)
  const updateSettings = useSettingsStore((state) => state.updateSettings)

  const groups: Array<{ labelKey: string; toggles: TaskToggle[] }> = [
    {
      labelKey: 'tasks.display',
      toggles: [
        {
          key: 'showTaskCalendarLabels',
          setting: 'show-task-calendar-labels',
          checked: showTaskCalendarLabels,
          update: { showTaskCalendarLabels: !showTaskCalendarLabels },
        },
        {
          key: 'showSidebarTaskCalendarLabels',
          setting: 'show-sidebar-task-calendar-labels',
          checked: showSidebarTaskCalendarLabels,
          update: { showSidebarTaskCalendarLabels: !showSidebarTaskCalendarLabels },
        },
        {
          key: 'hideCompletedTasks',
          setting: 'hide-completed-tasks',
          checked: hideCompletedTasksInMonthView,
          update: { hideCompletedTasksInMonthView: !hideCompletedTasksInMonthView },
        },
      ],
    },
    {
      labelKey: 'tasks.reminders',
      toggles: [
        {
          key: 'taskDueDateReminders',
          setting: 'task-due-date-reminders',
          checked: taskDueDateReminders,
          update: { taskDueDateReminders: !taskDueDateReminders },
        },
        {
          key: 'overdueTaskBadge',
          setting: 'overdue-task-badge',
          checked: overdueTaskBadge,
          update: { overdueTaskBadge: !overdueTaskBadge },
        },
      ],
    },
  ]

  return (
    <section
      className={`${styles.section} ${styles.sectionActive}`}
      data-component="tasks-settings"
    >
      <SettingsPageHeading title={t('tasks.title')} searchControl={searchControl} />
      {groups.map(({ labelKey, toggles }) => (
        <div key={labelKey} className={styles.group}>
          <div className={styles.groupLabel}>{t(labelKey)}</div>
          {toggles.map(({ key, setting, checked, update }) => (
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
                    onChange={() => updateSettings(update)}
                  />
                  <span className={styles.pill} />
                  <span className={styles.knob} />
                </label>
              </div>
            </div>
          ))}
        </div>
      ))}
    </section>
  )
}
