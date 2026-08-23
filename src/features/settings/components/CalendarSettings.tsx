import { useMemo, type JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { useSettingsStore, DURATION_OPTIONS, DEFAULT_REMINDER_OPTIONS } from '@/store/settingsStore'
import { useCalendarStore } from '@/store/calendarStore'
import { getSupportedTimezones, TIMEZONE_PRESETS } from '@/lib/timezoneHelper'
import styles from './Settings.module.css'

export function CalendarSettings(): JSX.Element {
  const { t } = useTranslation('settings')
  const defaultView = useSettingsStore((s) => s.defaultView)
  const showWeekNumbers = useSettingsStore((s) => s.showWeekNumbers)
  const showWeekNumbersInSidebar = useSettingsStore((s) => s.showWeekNumbersInSidebar)
  const agendaBelowMonthEnabled = useSettingsStore((s) => s.agendaBelowMonthEnabled)
  const eventDensity = useSettingsStore((s) => s.eventDensity)
  const compactRecurringEvents = useSettingsStore((s) => s.compactRecurringEvents)
  const compressPastWeeks = useSettingsStore((s) => s.compressPastWeeks)
  const monthViewEventLimit = useSettingsStore((s) => s.monthViewEventLimit)
  const hideCompletedTasksInMonthView = useSettingsStore((s) => s.hideCompletedTasksInMonthView)
  const fadePastDaysInAgenda = useSettingsStore((s) => s.fadePastDaysInAgenda)
  const defaultDuration = useSettingsStore((s) => s.defaultDuration)
  const defaultReminderMinutes = useSettingsStore((s) => s.defaultReminderMinutes)
  const secondaryTimezoneEnabled = useSettingsStore((s) => s.secondaryTimezoneEnabled)
  const secondaryTimezone = useSettingsStore((s) => s.secondaryTimezone)
  const secondaryTimezoneLabel = useSettingsStore((s) => s.secondaryTimezoneLabel)
  const updateSettings = useSettingsStore((s) => s.updateSettings)
  const calendars = useCalendarStore((s) => s.calendars)
  const updateCalendar = useCalendarStore((s) => s.updateCalendar)

  const allTimezones = useMemo(() => getSupportedTimezones(), [])

  const defaultCalendar = calendars.find((c) => c.isDefault) || calendars[0]
  const isCustomDuration = !DURATION_OPTIONS.some((o) => o.value === defaultDuration)

  return (
    <section
      className={`${styles.section} ${styles.sectionActive}`}
      data-component="calendar-settings"
    >
      <h1 className={styles.pageTitle}>{t('calendar.title')}</h1>

      <div className={styles.group}>
        <div className={styles.groupLabel}>{t('calendar.display')}</div>
        <div
          className={styles.row}
          data-component="setting-row"
          data-setting="default-view"
          data-value={defaultView}
        >
          <div className={styles.rowInfo}>
            <div className={styles.rowLabel}>{t('calendar.defaultView.label')}</div>
            <div className={styles.rowDesc}>{t('calendar.defaultView.desc')}</div>
          </div>
          <div className={styles.rowControl}>
            <div className={styles.seg} role="radiogroup" aria-label={t('calendar.defaultView.ariaLabel')}>
              {[
                { value: 'month', label: t('calendar.defaultView.month') },
                { value: 'week', label: t('calendar.defaultView.week') },
                { value: 'day', label: t('calendar.defaultView.day') },
                { value: 'agenda', label: t('calendar.defaultView.agenda') },
              ].map((opt) => (
                <button
                  key={opt.value}
                  className={`${styles.segTab} ${defaultView === opt.value ? styles.segTabActive : ''}`}
                  role="radio"
                  aria-checked={defaultView === opt.value}
                  data-active={defaultView === opt.value ? 'true' : undefined}
                  onClick={() =>
                    updateSettings({
                      defaultView: opt.value as 'month' | 'week' | 'day' | 'agenda',
                    })
                  }
                  type="button"
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div
          className={styles.row}
          data-component="setting-row"
          data-setting="show-week-numbers"
          data-value={String(showWeekNumbers)}
        >
          <div className={styles.rowInfo}>
            <div className={styles.rowLabel}>{t('calendar.showWeekNumbers.label')}</div>
            <div className={styles.rowDesc}>{t('calendar.showWeekNumbers.desc')}</div>
          </div>
          <div className={styles.rowControl}>
            <label
              className={styles.toggle}
              data-component="toggle"
              data-setting="show-week-numbers"
            >
              <input
                type="checkbox"
                checked={showWeekNumbers}
                aria-label={t('calendar.showWeekNumbers.ariaLabel')}
                onChange={() => updateSettings({ showWeekNumbers: !showWeekNumbers })}
              />
              <span className={styles.pill} />
              <span className={styles.knob} />
            </label>
          </div>
        </div>
        <div
          className={styles.row}
          data-component="setting-row"
          data-setting="show-week-numbers-in-sidebar"
          data-value={String(showWeekNumbersInSidebar)}
        >
          <div className={styles.rowInfo}>
            <div className={styles.rowLabel}>{t('calendar.showWeekNumbersInSidebar.label')}</div>
            <div className={styles.rowDesc}>{t('calendar.showWeekNumbersInSidebar.desc')}</div>
          </div>
          <div className={styles.rowControl}>
            <label
              className={styles.toggle}
              data-component="toggle"
              data-setting="show-week-numbers-in-sidebar"
            >
              <input
                type="checkbox"
                checked={showWeekNumbersInSidebar}
                aria-label={t('calendar.showWeekNumbersInSidebar.ariaLabel')}
                onChange={() =>
                  updateSettings({ showWeekNumbersInSidebar: !showWeekNumbersInSidebar })
                }
              />
              <span className={styles.pill} />
              <span className={styles.knob} />
            </label>
          </div>
        </div>
        <div
          className={`${styles.row} ${styles.rowDisabled}`}
          data-component="setting-row"
          data-setting="event-density"
          data-value={eventDensity}
          title={t('calendar.eventDensity.notAvailable')}
        >
          <div className={styles.rowInfo}>
            <div className={styles.rowLabel}>{t('calendar.eventDensity.label')}</div>
            <div className={styles.rowDesc}>{t('calendar.eventDensity.desc')}</div>
          </div>
          <div className={styles.rowControl}>
            <div className={styles.seg} role="radiogroup" aria-label={t('calendar.eventDensity.ariaLabel')}>
              {[
                { value: 'compact', label: t('calendar.eventDensity.compact') },
                { value: 'comfortable', label: t('calendar.eventDensity.comfortable') },
              ].map((opt) => (
                <button
                  key={opt.value}
                  className={`${styles.segTab} ${eventDensity === opt.value ? styles.segTabActive : ''}`}
                  role="radio"
                  aria-checked={eventDensity === opt.value}
                  data-active={eventDensity === opt.value ? 'true' : undefined}
                  onClick={() =>
                    updateSettings({ eventDensity: opt.value as 'comfortable' | 'compact' })
                  }
                  type="button"
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div
          className={styles.row}
          data-component="setting-row"
          data-setting="agenda-below-month-enabled"
          data-value={String(agendaBelowMonthEnabled)}
        >
          <div className={styles.rowInfo}>
            <div className={styles.rowLabel}>{t('calendar.agendaBelowMonth.label')}</div>
            <div className={styles.rowDesc}>{t('calendar.agendaBelowMonth.desc')}</div>
          </div>
          <div className={styles.rowControl}>
            <label
              className={styles.toggle}
              data-component="toggle"
              data-setting="agenda-below-month-enabled"
            >
              <input
                type="checkbox"
                checked={agendaBelowMonthEnabled}
                aria-label={t('calendar.agendaBelowMonth.ariaLabel')}
                onChange={() =>
                  updateSettings({ agendaBelowMonthEnabled: !agendaBelowMonthEnabled })
                }
              />
              <span className={styles.pill} />
              <span className={styles.knob} />
            </label>
          </div>
        </div>
      </div>

      <div className={styles.group}>
        <div className={styles.groupLabel}>{t('calendar.secondaryTimezoneGroup')}</div>
        <div
          className={styles.row}
          data-component="setting-row"
          data-setting="secondary-timezone-enabled"
          data-value={String(secondaryTimezoneEnabled)}
        >
          <div className={styles.rowInfo}>
            <div className={styles.rowLabel}>{t('calendar.secondaryTimezoneEnabled.label')}</div>
            <div className={styles.rowDesc}>{t('calendar.secondaryTimezoneEnabled.desc')}</div>
          </div>
          <div className={styles.rowControl}>
            <label
              className={styles.toggle}
              data-component="toggle"
              data-setting="secondary-timezone-enabled"
            >
              <input
                type="checkbox"
                checked={secondaryTimezoneEnabled}
                aria-label={t('calendar.secondaryTimezoneEnabled.ariaLabel')}
                onChange={() =>
                  updateSettings({
                    secondaryTimezoneEnabled: !secondaryTimezoneEnabled,
                    ...(!secondaryTimezoneEnabled && !secondaryTimezone
                      ? { secondaryTimezone: 'UTC' }
                      : {}),
                  })
                }
              />
              <span className={styles.pill} />
              <span className={styles.knob} />
            </label>
          </div>
        </div>
        {secondaryTimezoneEnabled && (
          <>
            <div
              className={styles.row}
              data-component="setting-row"
              data-setting="secondary-timezone"
              data-value={secondaryTimezone || ''}
            >
              <div className={styles.rowInfo}>
                <div className={styles.rowLabel}>{t('calendar.secondaryTimezone.label')}</div>
                <div className={styles.rowDesc}>{t('calendar.secondaryTimezone.desc')}</div>
              </div>
              <div className={styles.rowControl}>
                <select
                  className={styles.select}
                  value={secondaryTimezone || 'UTC'}
                  aria-label={t('calendar.secondaryTimezone.ariaLabel')}
                  onChange={(e) => updateSettings({ secondaryTimezone: e.target.value })}
                >
                  <optgroup label={t('calendar.secondaryTimezone.presets')}>
                    {TIMEZONE_PRESETS.map((tz) => (
                      <option key={`preset-${tz.value}`} value={tz.value}>
                        {tz.label}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label={t('calendar.secondaryTimezone.allTimezones')}>
                    {allTimezones.map((tz) => (
                      <option key={`all-${tz}`} value={tz}>
                        {tz}
                      </option>
                    ))}
                  </optgroup>
                </select>
              </div>
            </div>
            <div
              className={styles.row}
              data-component="setting-row"
              data-setting="secondary-timezone-label"
              data-value={secondaryTimezoneLabel || ''}
            >
              <div className={styles.rowInfo}>
                <div className={styles.rowLabel}>{t('calendar.secondaryTimezoneLabel.label')}</div>
                <div className={styles.rowDesc}>{t('calendar.secondaryTimezoneLabel.desc')}</div>
              </div>
              <div className={styles.rowControl}>
                <input
                  type="text"
                  className={styles.textInput}
                  maxLength={8}
                  placeholder={t('calendar.secondaryTimezoneLabel.placeholder')}
                  value={secondaryTimezoneLabel ?? ''}
                  aria-label={t('calendar.secondaryTimezoneLabel.ariaLabel')}
                  onChange={(e) => {
                    const val = e.target.value.slice(0, 8)
                    const trimmed = val.trim()
                    updateSettings({ secondaryTimezoneLabel: trimmed === '' ? null : val })
                  }}
                />
              </div>
            </div>
          </>
        )}
      </div>

      <div className={styles.group}>
        <div className={styles.groupLabel}>{t('calendar.gridBehaviour')}</div>
        <div
          className={styles.row}
          data-component="setting-row"
          data-setting="compact-recurring-events"
          data-value={String(compactRecurringEvents)}
        >
          <div className={styles.rowInfo}>
            <div className={styles.rowLabel}>{t('calendar.compactRecurringEvents.label')}</div>
            <div className={styles.rowDesc}>{t('calendar.compactRecurringEvents.desc')}</div>
          </div>
          <div className={styles.rowControl}>
            <label
              className={styles.toggle}
              data-component="toggle"
              data-setting="compact-recurring-events"
            >
              <input
                type="checkbox"
                checked={compactRecurringEvents}
                aria-label={t('calendar.compactRecurringEvents.ariaLabel')}
                onChange={() => updateSettings({ compactRecurringEvents: !compactRecurringEvents })}
              />
              <span className={styles.pill} />
              <span className={styles.knob} />
            </label>
          </div>
        </div>
        <div
          className={styles.row}
          data-component="setting-row"
          data-setting="compress-past-weeks"
          data-value={String(compressPastWeeks)}
        >
          <div className={styles.rowInfo}>
            <div className={styles.rowLabel}>{t('calendar.compressPastWeeks.label')}</div>
            <div className={styles.rowDesc}>{t('calendar.compressPastWeeks.desc')}</div>
          </div>
          <div className={styles.rowControl}>
            <label
              className={styles.toggle}
              data-component="toggle"
              data-setting="compress-past-weeks"
            >
              <input
                type="checkbox"
                checked={compressPastWeeks}
                aria-label={t('calendar.compressPastWeeks.ariaLabel')}
                onChange={() => updateSettings({ compressPastWeeks: !compressPastWeeks })}
              />
              <span className={styles.pill} />
              <span className={styles.knob} />
            </label>
          </div>
        </div>
        <div
          className={styles.row}
          data-component="setting-row"
          data-setting="fade-past-days-in-agenda"
          data-value={fadePastDaysInAgenda}
        >
          <div className={styles.rowInfo}>
            <div className={styles.rowLabel}>{t('calendar.fadePastDays.label')}</div>
            <div className={styles.rowDesc}>{t('calendar.fadePastDays.desc')}</div>
          </div>
          <div className={styles.rowControl}>
            <div className={styles.seg} role="radiogroup" aria-label={t('calendar.fadePastDays.ariaLabel')}>
              {[
                { value: 'never', label: t('calendar.fadePastDays.never') },
                { value: 'current', label: t('calendar.fadePastDays.current') },
                { value: 'all', label: t('calendar.fadePastDays.all') },
              ].map((opt) => (
                <button
                  key={opt.value}
                  className={`${styles.segTab} ${fadePastDaysInAgenda === opt.value ? styles.segTabActive : ''}`}
                  role="radio"
                  aria-checked={fadePastDaysInAgenda === opt.value}
                  data-active={fadePastDaysInAgenda === opt.value ? 'true' : undefined}
                  onClick={() =>
                    updateSettings({
                      fadePastDaysInAgenda: opt.value as 'never' | 'current' | 'all',
                    })
                  }
                  type="button"
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div
          className={styles.row}
          data-component="setting-row"
          data-setting="hide-completed-tasks"
          data-value={String(hideCompletedTasksInMonthView)}
        >
          <div className={styles.rowInfo}>
            <div className={styles.rowLabel}>{t('calendar.hideCompletedTasks.label')}</div>
            <div className={styles.rowDesc}>{t('calendar.hideCompletedTasks.desc')}</div>
          </div>
          <div className={styles.rowControl}>
            <label
              className={styles.toggle}
              data-component="toggle"
              data-setting="hide-completed-tasks"
            >
              <input
                type="checkbox"
                checked={hideCompletedTasksInMonthView}
                aria-label={t('calendar.hideCompletedTasks.ariaLabel')}
                onChange={() =>
                  updateSettings({ hideCompletedTasksInMonthView: !hideCompletedTasksInMonthView })
                }
              />
              <span className={styles.pill} />
              <span className={styles.knob} />
            </label>
          </div>
        </div>
        <div
          className={styles.row}
          data-component="setting-row"
          data-setting="month-view-event-limit"
          data-value={String(monthViewEventLimit)}
        >
          <div className={styles.rowInfo}>
            <div className={styles.rowLabel}>{t('calendar.monthViewEventLimit.label')}</div>
            <div className={styles.rowDesc}>{t('calendar.monthViewEventLimit.desc')}</div>
          </div>
          <div className={styles.rowControl}>
            <select
              className={styles.select}
              style={{ minWidth: '120px' }}
              value={monthViewEventLimit}
              aria-label={t('calendar.monthViewEventLimit.ariaLabel')}
              onChange={(e) => updateSettings({ monthViewEventLimit: Number(e.target.value) })}
            >
              <option value={0}>{t('calendar.monthViewEventLimit.auto')}</option>
              <option value={2}>2</option>
              <option value={3}>3</option>
              <option value={4}>4</option>
              <option value={5}>5</option>
            </select>
          </div>
        </div>
      </div>

      <div className={styles.group}>
        <div className={styles.groupLabel}>{t('calendar.newEventDefaults')}</div>
        <div
          className={styles.row}
          data-component="setting-row"
          data-setting="default-duration"
          data-value={String(defaultDuration)}
        >
          <div className={styles.rowInfo}>
            <div className={styles.rowLabel}>{t('calendar.defaultDuration.label')}</div>
            <div className={styles.rowDesc}>{t('calendar.defaultDuration.desc')}</div>
          </div>
          <div className={styles.rowControl}>
            <select
              className={`${styles.select} ${styles.selectCompact}`}
              value={isCustomDuration ? 'custom' : String(defaultDuration)}
              aria-label={t('calendar.defaultDuration.ariaLabel')}
              onChange={(e) => {
                if (e.target.value === 'custom') {
                  if (!isCustomDuration) updateSettings({ defaultDuration: 45 })
                } else {
                  updateSettings({ defaultDuration: Number(e.target.value) })
                }
              }}
            >
              {DURATION_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {t(opt.labelKey)}
                </option>
              ))}
              <option value="custom">{t('calendar.defaultDuration.custom')}</option>
            </select>
            {isCustomDuration && (
              <span className={styles.numberInputWrap}>
                <input
                  type="number"
                  className={styles.numberInput}
                  min={1}
                  max={1440}
                  step={5}
                  value={defaultDuration}
                  aria-label={t('calendar.defaultDuration.customAriaLabel')}
                  onChange={(e) => {
                    const n = Number(e.target.value)
                    if (!Number.isFinite(n) || e.target.value === '') return
                    updateSettings({ defaultDuration: Math.min(1440, Math.max(1, Math.round(n))) })
                  }}
                />
                <span className={styles.numberInputUnit}>{t('calendar.defaultDuration.unit')}</span>
              </span>
            )}
          </div>
        </div>
        <div
          className={styles.row}
          data-component="setting-row"
          data-setting="default-calendar"
          data-value={defaultCalendar?.id || ''}
        >
          <div className={styles.rowInfo}>
            <div className={styles.rowLabel}>{t('calendar.defaultCalendar.label')}</div>
            <div className={styles.rowDesc}>{t('calendar.defaultCalendar.desc')}</div>
          </div>
          <div className={styles.rowControl}>
            <select
              className={styles.select}
              value={defaultCalendar?.id || ''}
              aria-label={t('calendar.defaultCalendar.ariaLabel')}
              onChange={(e) => {
                calendars.forEach((cal) => {
                  updateCalendar(cal.id, { isDefault: cal.id === e.target.value })
                })
              }}
            >
              {calendars.map((cal) => (
                <option key={cal.id} value={cal.id}>
                  {cal.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div
          className={styles.row}
          data-component="setting-row"
          data-setting="default-reminder"
          data-value={defaultReminderMinutes === null ? 'none' : String(defaultReminderMinutes)}
        >
          <div className={styles.rowInfo}>
            <div className={styles.rowLabel}>{t('calendar.defaultReminder.label')}</div>
            <div className={styles.rowDesc}>{t('calendar.defaultReminder.desc')}</div>
          </div>
          <div className={styles.rowControl}>
            <select
              className={styles.select}
              value={defaultReminderMinutes === null ? '' : defaultReminderMinutes}
              aria-label={t('calendar.defaultReminder.ariaLabel')}
              onChange={(e) =>
                updateSettings({
                  defaultReminderMinutes: e.target.value === '' ? null : Number(e.target.value),
                })
              }
            >
              {DEFAULT_REMINDER_OPTIONS.map((opt) => (
                <option key={opt.labelKey} value={opt.value ?? ''}>
                  {t(opt.labelKey)}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>
    </section>
  )
}
