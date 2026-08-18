import { useState, useEffect } from 'react'
import type { JSX } from 'react'
import { Capacitor } from '@capacitor/core'
import {
  useSettingsStore,
  DATE_FORMAT_OPTIONS,
  TIME_FORMAT_OPTIONS,
  MAP_PROVIDER_OPTIONS,
} from '@/store/settingsStore'
import { useSettingsSync } from '@/hooks/useSettingsSync'
import { classifySyncError, CORS_HEADER_SNIPPET } from '@/features/caldav/client/errorMessages'
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
function formatSyncError(error: string): JSX.Element {
  switch (classifySyncError(error)) {
    case 'cors':
      return (
        <>
          Your server is blocking the connection. This usually means CORS headers aren't configured.
          Check that your CalDAV server sends these, and that it answers OPTIONS:
          <code style={codeBlockStyle}>{CORS_HEADER_SNIPPET}</code>
          <span style={{ marginTop: 6, display: 'block' }}>
            Sync → your account → <strong>Diagnose</strong> will tell you which part is missing. See{' '}
            <a
              href="https://github.com/nickvdyck/baikal#cors"
              target="_blank"
              rel="noreferrer"
              style={{ color: 'var(--accent)' }}
            >
              Baikal CORS docs
            </a>{' '}
            for help.
          </span>
        </>
      )

    case 'network':
      return (
        <>
          Couldn't reach your CalDAV server. Check your internet connection and make sure the server
          is online — a missing CORS header looks identical from here, so try{' '}
          <strong>Diagnose</strong> under Sync if the server is up.
        </>
      )

    case 'timeout':
      return (
        <>
          Your CalDAV server took too long to respond. It may be overloaded — try again in a moment.
        </>
      )

    case 'auth':
      return (
        <>
          Authentication failed. Check your CalDAV username and password. Many providers require an
          app-specific password rather than your account password.
        </>
      )

    case 'forbidden':
      return (
        <>
          The server refused the change. You may not have write access to this calendar, or the
          server rejected the data.
        </>
      )

    case 'quota':
      return (
        <>
          Your server storage is full. Free up space on the server and try again.
        </>
      )

    case 'rate-limited':
      return (
        <>
          The server is rate-limiting requests. Try again in a moment.
        </>
      )

    case 'not-found':
      return (
        <>
          The settings calendar wasn't found on your server. It may have been deleted. Try disabling
          and re-enabling sync.
        </>
      )

    case 'conflict':
      return (
        <>
          Your settings were changed on another device since this one last synced. Sync again to
          pick up the newer copy.
        </>
      )

    case 'server':
      return (
        <>
          Your CalDAV server returned an error. This is a problem on the server side — check its
          logs.
        </>
      )

    case 'unknown':
      return <>{error}</>
  }
}

export function GeneralSettings(): JSX.Element {
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
      <h1 className={styles.pageTitle}>General</h1>
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
            <div className={styles.rowLabel}>Date Format</div>
            <div className={styles.rowDesc}>How dates appear throughout the app</div>
          </div>
          <div className={styles.rowControl}>
            <select
              className={styles.select}
              value={dateFormat}
              aria-label="Date format"
              onChange={(e) =>
                updateSettings({
                  dateFormat: e.target.value as 'MM/dd/yyyy' | 'dd/MM/yyyy' | 'yyyy-MM-dd',
                })
              }
            >
              {DATE_FORMAT_OPTIONS.map((opt) => (
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
          data-setting="map-provider"
          data-value={mapProvider}
        >
          <div className={styles.rowInfo}>
            <div className={styles.rowLabel}>Map Provider</div>
            <div className={styles.rowDesc}>Service used to open event locations</div>
          </div>
          <div className={styles.rowControl}>
            <select
              className={styles.select}
              value={mapProvider}
              aria-label="Map provider"
              onChange={(e) =>
                updateSettings({
                  mapProvider: e.target.value as typeof mapProvider,
                })
              }
            >
              {MAP_PROVIDER_OPTIONS.map((opt) => (
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
          data-setting="time-format"
          data-value={timeFormat}
        >
          <div className={styles.rowInfo}>
            <div className={styles.rowLabel}>Time Format</div>
            <div className={styles.rowDesc}>12-hour or 24-hour time display</div>
          </div>
          <div className={styles.rowControl}>
            <div className={styles.seg} role="radiogroup" aria-label="Time format">
              {TIME_FORMAT_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  className={`${styles.segTab} ${timeFormat === opt.value ? styles.segTabActive : ''}`}
                  role="radio"
                  aria-checked={timeFormat === opt.value}
                  data-active={timeFormat === opt.value ? 'true' : undefined}
                  onClick={() => updateSettings({ timeFormat: opt.value as '12h' | '24h' })}
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
          data-setting="first-day-of-week"
          data-value={String(firstDayOfWeek)}
        >
          <div className={styles.rowInfo}>
            <div className={styles.rowLabel}>First Day of Week</div>
            <div className={styles.rowDesc}>Start of the week in week and day views</div>
          </div>
          <div className={styles.rowControl}>
            <div className={styles.seg} role="radiogroup" aria-label="First day of week">
              {[
                { value: 6 as const, label: 'Saturday' },
                { value: 0 as const, label: 'Sunday' },
                { value: 1 as const, label: 'Monday' },
              ].map((opt) => (
                <button
                  key={opt.value}
                  className={`${styles.segTab} ${firstDayOfWeek === opt.value ? styles.segTabActive : ''}`}
                  role="radio"
                  aria-checked={firstDayOfWeek === opt.value}
                  data-active={firstDayOfWeek === opt.value ? 'true' : undefined}
                  onClick={() => updateSettings({ firstDayOfWeek: opt.value })}
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
          data-setting="language"
          data-value="en"
        >
          <div className={styles.rowInfo}>
            <div className={styles.rowLabel}>Language</div>
            <div className={styles.rowDesc}>Interface language</div>
          </div>
          <div className={styles.rowControl}>
            <select className={styles.select} defaultValue="en" aria-label="Language">
              <option value="en">English</option>
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
            <div className={styles.rowLabel}>Journal</div>
            <div className={styles.rowDesc}>Attach freeform notes to days in your calendar</div>
          </div>
          <div className={styles.rowControl}>
            <label className={styles.toggle} data-component="toggle" data-setting="journal">
              <input
                type="checkbox"
                checked={journalEnabled}
                aria-label="Journal"
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
            <div className={styles.rowLabel}>Contacts</div>
            <div className={styles.rowDesc}>Manage your address book with CardDAV sync</div>
          </div>
          <div className={styles.rowControl}>
            <label className={styles.toggle} data-component="toggle" data-setting="contacts">
              <input
                type="checkbox"
                checked={contactsEnabled}
                aria-label="Contacts"
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
              <div className={styles.rowLabel}>Haptic Feedback</div>
              <div className={styles.rowDesc}>
                Vibrate on taps, swipes and long presses. Turn off if it feels sluggish.
              </div>
            </div>
            <div className={styles.rowControl}>
              <label className={styles.toggle} data-component="toggle" data-setting="haptics">
                <input
                  type="checkbox"
                  checked={enableHaptics}
                  aria-label="Haptic feedback"
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
      <div className={styles.groupLabel}>Sync</div>
      <div className={styles.group}>
        <div
          className={styles.row}
          data-component="setting-row"
          data-setting="settings-sync"
          data-value={String(syncEnabled)}
        >
          <div className={styles.rowInfo}>
            <div className={styles.rowLabel}>CalDAV Settings Sync</div>
            <div className={styles.rowDesc}>
              {syncEnabled
                ? 'Pulls settings automatically. Save changes manually with the button below.'
                : 'Enable to sync your settings across devices via CalDAV'}
            </div>
            {syncError && (
              <div className={styles.syncError} data-component="sync-error">
                <div className={styles.syncErrorTitle}>Something went wrong</div>
                <div className={styles.syncErrorBody}>{formatSyncError(syncError)}</div>
              </div>
            )}
          </div>
          <div className={styles.rowControl}>
            {syncEnabled ? (
              <div className={styles.syncedBadge}>
                {syncing && (
                  <span className={styles.syncInfo}>
                    <span className={styles.spinner} />
                    Syncing…
                  </span>
                )}
                {lastSyncAt && !syncing && (
                  <span className={styles.syncTime}>
                    Synced {new Date(lastSyncAt).toLocaleTimeString()}
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
                    aria-label="Disable settings sync"
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
                Enable
              </button>
            )}
          </div>
        </div>
        {syncEnabled && (
          <div className={styles.row} data-component="setting-row" data-setting="sync-now">
            <div className={styles.rowInfo}>
              <div className={styles.rowLabel}>Sync Now</div>
              <div className={styles.rowDesc}>Save your local settings to the server</div>
            </div>
            <div className={styles.rowControl}>
              <button
                className={`${styles.actionBtn} ${styles.actionBtnElevated}`}
                onClick={() => pushSync()}
                disabled={syncing}
                data-component="action-button"
                data-action="sync-now"
              >
                {syncing ? 'Saving...' : 'Save'}
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
              Enable Settings Sync
            </h3>
            <p className={styles.modalText}>
              This will create a <strong>Calino Settings</strong> calendar on your CalDAV server. It
              contains a single event that stores your preferences (theme, first day of week, etc.)
              as JSON data.
            </p>
            <p className={styles.modalTextSmall}>
              The calendar is hidden from Calino's sidebar but may be visible in other CalDAV
              clients. It does not affect your other calendars and can be deleted at any time from
              settings.
            </p>
            <p className={styles.modalText}>Choose an account to sync with:</p>
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
                        <span className={styles.accountPickerBtnLoadingText}>Setting up…</span>
                      )}
                    </div>
                    <div className={styles.accountPickerBtnServer}>{account.serverUrl}</div>
                  </button>
                )
              })}
            </div>
            <button className={styles.modalCancelBtn} onClick={() => setShowAccountPicker(false)}>
              Cancel
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
              Disable Settings Sync?
            </h3>
            <p className={styles.modalText}>
              Your settings will no longer sync across devices. Would you also like to delete the
              settings file from your server?
            </p>
            <div className={styles.modalFooter}>
              <button
                className={styles.confirmBtn}
                onClick={async () => {
                  await disableSync(false)
                  setShowDisableConfirm(false)
                }}
              >
                Keep File
              </button>
              <button
                className={styles.confirmBtnDanger}
                onClick={async () => {
                  await disableSync(true)
                  setShowDisableConfirm(false)
                }}
              >
                Delete &amp; Disable
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
