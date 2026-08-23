import { useState, useEffect } from 'react'
import type { JSX } from 'react'
import { Capacitor } from '@capacitor/core'
import { Trans, useTranslation } from 'react-i18next'
import {
  useSettingsStore,
  DATE_FORMAT_OPTIONS,
  TIME_FORMAT_OPTIONS,
  MAP_PROVIDER_OPTIONS,
} from '@/store/settingsStore'
import { LANGUAGE_OPTIONS } from '@/lib/languages'
import type { Language } from '@/types'
import { useSettingsSync } from '@/hooks/useSettingsSync'
import { classifySyncError, CORS_HEADER_SNIPPET } from '@/features/caldav/client/errorMessages'
import { getFullWeekdayNames } from '@/features/calendar/components/weekdayLabels'
import styles from './Settings.module.css'

// Haptics are a native-only capability, and `enableHaptics` is deliberately
// kept out of SYNCABLE_SETTINGS — it's a per-device preference, since the
// device that stutters isn't necessarily every device on the account.
const isNative = Capacitor.isNativePlatform()

const codeBlockStyle = {
  display: 'block',
  marginTop: 6,
  padding: '6px 10px',
  borderRadius: 'var(--radius-sm)',
  background: 'rgba(44,40,33,0.04)',
  fontSize: 12,
  fontFamily: 'monospace',
  lineHeight: 1.5,
  whiteSpace: 'pre-wrap',
} as const

/**
 * Render a sync error as help rather than a stack trace.
 *
 * Bucketing lives in `classifySyncError` so this and the toast in
 * useSettingsSync can never disagree about what a given failure means — they
 * used to keep separate substring ladders over the same categories.
 */
function formatSyncError(error: string, t: (key: string) => string): JSX.Element {
  switch (classifySyncError(error)) {
    case 'cors':
      return (
        <>
          {t('general.syncError.cors')}
          <code style={codeBlockStyle}>{CORS_HEADER_SNIPPET}</code>
          <span style={{ marginTop: 6, display: 'block' }}>
            <Trans
              i18nKey="settings:general.syncError.corsHelp"
              components={{
                strong: <strong />,
                link: (
                  <a
                    href="https://github.com/nickvdyck/baikal#cors"
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: 'var(--accent)' }}
                  />
                ),
              }}
            />
          </span>
        </>
      )

    case 'network':
      return (
        <Trans i18nKey="settings:general.syncError.network" components={{ strong: <strong /> }} />
      )

    case 'timeout':
      return <>{t('general.syncError.timeout')}</>

    case 'auth':
      return <>{t('general.syncError.auth')}</>

    case 'forbidden':
      return <>{t('general.syncError.forbidden')}</>

    case 'quota':
      return <>{t('general.syncError.quota')}</>

    case 'rate-limited':
      return <>{t('general.syncError.rateLimited')}</>

    case 'not-found':
      return <>{t('general.syncError.notFound')}</>

    case 'conflict':
      return <>{t('general.syncError.conflict')}</>

    case 'server':
      return <>{t('general.syncError.server')}</>

    case 'unknown':
      return <>{error}</>
  }
}

export function GeneralSettings(): JSX.Element {
  const { t } = useTranslation('settings')
  const language = useSettingsStore((s) => s.language)
  const dateFormat = useSettingsStore((s) => s.dateFormat)
  const timeFormat = useSettingsStore((s) => s.timeFormat)
  const firstDayOfWeek = useSettingsStore((s) => s.firstDayOfWeek)
  const mapProvider = useSettingsStore((s) => s.mapProvider)
  const journalEnabled = useSettingsStore((s) => s.journalEnabled)
  const contactsEnabled = useSettingsStore((s) => s.contactsEnabled)
  const enableHaptics = useSettingsStore((s) => s.enableHaptics)
  const updateSettings = useSettingsStore((s) => s.updateSettings)

  // Settings sync
  const {
    enabled: syncEnabled,
    syncing,
    lastSyncAt,
    error: syncError,
    accounts: syncAccounts,
    enable: enableSync,
    disable: disableSync,
    push: pushSync,
  } = useSettingsSync()
  const [showAccountPicker, setShowAccountPicker] = useState(false)
  const [showDisableConfirm, setShowDisableConfirm] = useState(false)
  const [enablingAccountId, setEnablingAccountId] = useState<string | null>(null)

  // Close modals on Escape key
  useEffect(() => {
    if (!showAccountPicker && !showDisableConfirm) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowAccountPicker(false)
        setShowDisableConfirm(false)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [showAccountPicker, showDisableConfirm])

  return (
    <section
      className={`${styles.section} ${styles.sectionActive}`}
      data-component="general-settings"
    >
      <h1 className={styles.pageTitle}>{t('general.title')}</h1>
      <div className={styles.group}>
        {/* No timezone picker: Calino renders every date and time in the
            device's own zone, and always has. The control that used to sit
            here promised "All events will be displayed in this timezone" but
            was never read by anything — picking a zone changed nothing, which
            made it worse than absent. The `timezone` setting itself survives
            in the store and the sync payload so other clients' values still
            round-trip untouched; see settingsStore.ts. */}
        <div
          className={styles.row}
          data-component="setting-row"
          data-setting="date-format"
          data-value={dateFormat}
        >
          <div className={styles.rowInfo}>
            <div className={styles.rowLabel}>{t('general.dateFormat.label')}</div>
            <div className={styles.rowDesc}>{t('general.dateFormat.desc')}</div>
          </div>
          <div className={styles.rowControl}>
            <select
              className={styles.select}
              value={dateFormat}
              aria-label={t('general.dateFormat.ariaLabel')}
              onChange={(e) =>
                updateSettings({
                  dateFormat: e.target.value as 'MM/dd/yyyy' | 'dd/MM/yyyy' | 'yyyy-MM-dd',
                })
              }
            >
              {DATE_FORMAT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {t(opt.labelKey)}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div
          className={styles.row}
          data-component="setting-row"
          data-setting="map-provider"
          data-value={mapProvider}
        >
          <div className={styles.rowInfo}>
            <div className={styles.rowLabel}>{t('general.mapProvider.label')}</div>
            <div className={styles.rowDesc}>{t('general.mapProvider.desc')}</div>
          </div>
          <div className={styles.rowControl}>
            <select
              className={styles.select}
              value={mapProvider}
              aria-label={t('general.mapProvider.ariaLabel')}
              onChange={(e) =>
                updateSettings({
                  mapProvider: e.target.value as typeof mapProvider,
                })
              }
            >
              {MAP_PROVIDER_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {t(opt.labelKey)}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div
          className={styles.row}
          data-component="setting-row"
          data-setting="time-format"
          data-value={timeFormat}
        >
          <div className={styles.rowInfo}>
            <div className={styles.rowLabel}>{t('general.timeFormat.label')}</div>
            <div className={styles.rowDesc}>{t('general.timeFormat.desc')}</div>
          </div>
          <div className={styles.rowControl}>
            <div className={styles.seg} role="radiogroup" aria-label={t('general.timeFormat.ariaLabel')}>
              {TIME_FORMAT_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  className={`${styles.segTab} ${timeFormat === opt.value ? styles.segTabActive : ''}`}
                  role="radio"
                  aria-checked={timeFormat === opt.value}
                  data-active={timeFormat === opt.value ? 'true' : undefined}
                  onClick={() => updateSettings({ timeFormat: opt.value as '12h' | '24h' })}
                >
                  {t(opt.labelKey)}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div
          className={styles.row}
          data-component="setting-row"
          data-setting="first-day-of-week"
          data-value={String(firstDayOfWeek)}
        >
          <div className={styles.rowInfo}>
            <div className={styles.rowLabel}>{t('general.firstDayOfWeek.label')}</div>
            <div className={styles.rowDesc}>{t('general.firstDayOfWeek.desc')}</div>
          </div>
          <div className={styles.rowControl}>
            <div
              className={styles.seg}
              role="radiogroup"
              aria-label={t('general.firstDayOfWeek.ariaLabel')}
            >
              {[6 as const, 0 as const, 1 as const].map((value) => (
                <button
                  key={value}
                  className={`${styles.segTab} ${firstDayOfWeek === value ? styles.segTabActive : ''}`}
                  role="radio"
                  aria-checked={firstDayOfWeek === value}
                  data-active={firstDayOfWeek === value ? 'true' : undefined}
                  onClick={() => updateSettings({ firstDayOfWeek: value })}
                >
                  {getFullWeekdayNames()[value]}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div
          className={styles.row}
          data-component="setting-row"
          data-setting="language"
          data-value={language}
        >
          <div className={styles.rowInfo}>
            <div className={styles.rowLabel}>{t('general.language.label')}</div>
            <div className={styles.rowDesc}>{t('general.language.desc')}</div>
          </div>
          <div className={styles.rowControl}>
            <select
              className={styles.select}
              value={language}
              aria-label={t('general.language.ariaLabel')}
              onChange={(e) => updateSettings({ language: e.target.value as Language })}
            >
              {/* Names stay in their own language and are never translated —
                  someone stranded in a language they can't read has to be able
                  to find their own in this list. */}
              {LANGUAGE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div
          className={styles.row}
          data-component="setting-row"
          data-setting="journal"
          data-value={String(journalEnabled)}
        >
          <div className={styles.rowInfo}>
            <div className={styles.rowLabel}>{t('general.journal.label')}</div>
            <div className={styles.rowDesc}>{t('general.journal.desc')}</div>
          </div>
          <div className={styles.rowControl}>
            <label className={styles.toggle} data-component="toggle" data-setting="journal">
              <input
                type="checkbox"
                checked={journalEnabled}
                aria-label={t('general.journal.ariaLabel')}
                onChange={(e) => updateSettings({ journalEnabled: e.target.checked })}
              />
              <span className={styles.pill} />
              <span className={styles.knob} />
            </label>
          </div>
        </div>
        <div
          className={styles.row}
          data-component="setting-row"
          data-setting="contacts"
          data-value={String(contactsEnabled)}
        >
          <div className={styles.rowInfo}>
            <div className={styles.rowLabel}>{t('general.contacts.label')}</div>
            <div className={styles.rowDesc}>{t('general.contacts.desc')}</div>
          </div>
          <div className={styles.rowControl}>
            <label className={styles.toggle} data-component="toggle" data-setting="contacts">
              <input
                type="checkbox"
                checked={contactsEnabled}
                aria-label={t('general.contacts.ariaLabel')}
                onChange={(e) => updateSettings({ contactsEnabled: e.target.checked })}
              />
              <span className={styles.pill} />
              <span className={styles.knob} />
            </label>
          </div>
        </div>
        {isNative && (
          <div
            className={styles.row}
            data-component="setting-row"
            data-setting="haptics"
            data-value={String(enableHaptics)}
          >
            <div className={styles.rowInfo}>
              <div className={styles.rowLabel}>{t('general.haptics.label')}</div>
              <div className={styles.rowDesc}>{t('general.haptics.desc')}</div>
            </div>
            <div className={styles.rowControl}>
              <label className={styles.toggle} data-component="toggle" data-setting="haptics">
                <input
                  type="checkbox"
                  checked={enableHaptics}
                  aria-label={t('general.haptics.ariaLabel')}
                  onChange={(e) => updateSettings({ enableHaptics: e.target.checked })}
                />
                <span className={styles.pill} />
                <span className={styles.knob} />
              </label>
            </div>
          </div>
        )}
      </div>

      {/* CalDAV Settings Sync */}
      <div className={styles.groupLabel}>{t('general.settingsSync.groupLabel')}</div>
      <div className={styles.group}>
        <div
          className={styles.row}
          data-component="setting-row"
          data-setting="settings-sync"
          data-value={String(syncEnabled)}
        >
          <div className={styles.rowInfo}>
            <div className={styles.rowLabel}>{t('general.settingsSync.label')}</div>
            <div className={styles.rowDesc}>
              {syncEnabled
                ? t('general.settingsSync.descEnabled')
                : t('general.settingsSync.descDisabled')}
            </div>
            {syncError && (
              <div className={styles.syncError} data-component="sync-error">
                <div className={styles.syncErrorTitle}>{t('general.settingsSync.somethingWrong')}</div>
                <div className={styles.syncErrorBody}>{formatSyncError(syncError, t)}</div>
              </div>
            )}
          </div>
          <div className={styles.rowControl}>
            {syncEnabled ? (
              <div className={styles.syncedBadge}>
                {syncing && (
                  <span className={styles.syncInfo}>
                    <span className={styles.spinner} />
                    {t('general.settingsSync.syncing')}
                  </span>
                )}
                {lastSyncAt && !syncing && (
                  <span className={styles.syncTime}>
                    {t('general.settingsSync.syncedAt', {
                      time: new Date(lastSyncAt).toLocaleTimeString(),
                    })}
                  </span>
                )}
                <label
                  className={styles.toggle}
                  data-component="toggle"
                  data-setting="settings-sync-toggle"
                >
                  <input
                    type="checkbox"
                    checked={syncEnabled}
                    aria-label={t('general.settingsSync.disableAriaLabel')}
                    onChange={() => setShowDisableConfirm(true)}
                  />
                  <span className={styles.pill} />
                  <span className={styles.knob} />
                </label>
              </div>
            ) : (
              <button
                className={`${styles.actionBtn} ${styles.actionBtnElevated}`}
                onClick={() => setShowAccountPicker(true)}
                disabled={syncAccounts.length === 0}
                data-component="action-button"
                data-action="enable-sync"
              >
                {t('general.settingsSync.enable')}
              </button>
            )}
          </div>
        </div>
        {syncEnabled && (
          <div className={styles.row} data-component="setting-row" data-setting="sync-now">
            <div className={styles.rowInfo}>
              <div className={styles.rowLabel}>{t('general.syncNow.label')}</div>
              <div className={styles.rowDesc}>{t('general.syncNow.desc')}</div>
            </div>
            <div className={styles.rowControl}>
              <button
                className={`${styles.actionBtn} ${styles.actionBtnElevated}`}
                onClick={() => pushSync()}
                disabled={syncing}
                data-component="action-button"
                data-action="sync-now"
              >
                {syncing ? t('general.syncNow.saving') : t('general.syncNow.save')}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Account Picker Modal */}
      {showAccountPicker && (
        <div
          className={styles.modalBackdrop}
          role="dialog"
          aria-modal="true"
          aria-labelledby="account-picker-title"
          data-component="modal-backdrop"
          data-modal="account-picker"
          onClick={() => setShowAccountPicker(false)}
        >
          <div
            className={styles.modalPanel}
            data-component="modal-panel"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className={styles.modalTitle} id="account-picker-title">
              {t('general.accountPicker.title')}
            </h3>
            <p className={styles.modalText}>
              <Trans
                i18nKey="settings:general.accountPicker.description"
                components={{ strong: <strong /> }}
              />
            </p>
            <p className={styles.modalTextSmall}>{t('general.accountPicker.descriptionSmall')}</p>
            <p className={styles.modalText}>{t('general.accountPicker.chooseAccount')}</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {syncAccounts.map((account) => {
                const isLoading = enablingAccountId === account.id
                return (
                  <button
                    key={account.id}
                    className={`${styles.accountPickerBtn} ${isLoading ? styles.accountPickerBtnLoading : ''} ${enablingAccountId && !isLoading ? styles.accountPickerBtnDisabled : ''}`}
                    disabled={enablingAccountId !== null}
                    data-component="account-picker-option"
                    data-account-id={account.id}
                    data-account-name={account.name}
                    onClick={async () => {
                      setEnablingAccountId(account.id)
                      try {
                        await enableSync(account.id)
                        setShowAccountPicker(false)
                      } catch {
                        // Error is shown via syncError
                      } finally {
                        setEnablingAccountId(null)
                      }
                    }}
                  >
                    <div className={styles.accountPickerBtnName}>
                      {account.name}
                      {isLoading && (
                        <span className={styles.accountPickerBtnLoadingText}>
                          {t('general.accountPicker.settingUp')}
                        </span>
                      )}
                    </div>
                    <div className={styles.accountPickerBtnServer}>{account.serverUrl}</div>
                  </button>
                )
              })}
            </div>
            <button className={styles.modalCancelBtn} onClick={() => setShowAccountPicker(false)}>
              {t('general.accountPicker.cancel')}
            </button>
          </div>
        </div>
      )}

      {/* Disable Confirmation Modal */}
      {showDisableConfirm && (
        <div
          className={styles.modalBackdrop}
          role="dialog"
          aria-modal="true"
          aria-labelledby="disable-sync-title"
          data-component="modal-backdrop"
          data-modal="disable-sync"
          onClick={() => setShowDisableConfirm(false)}
        >
          <div
            className={styles.modalPanel}
            data-component="modal-panel"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className={styles.modalTitle} id="disable-sync-title">
              {t('general.disableSync.title')}
            </h3>
            <p className={styles.modalText}>{t('general.disableSync.description')}</p>
            <div className={styles.modalFooter}>
              <button
                className={styles.confirmBtn}
                onClick={async () => {
                  await disableSync(false)
                  setShowDisableConfirm(false)
                }}
              >
                {t('general.disableSync.keepFile')}
              </button>
              <button
                className={styles.confirmBtnDanger}
                onClick={async () => {
                  await disableSync(true)
                  setShowDisableConfirm(false)
                }}
              >
                {t('general.disableSync.deleteAndDisable')}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
