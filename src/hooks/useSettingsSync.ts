/**
 * useSettingsSync — React hook for CalDAV settings sync.
 *
 * Follows the caldav-settings-sync-spec:
 *  - Uses a dedicated "Calino Settings" calendar collection
 *  - Settings stored as a single VEVENT with ATTACH;BASE64 payload
 *  - Conflict resolution via DTSTAMP comparison
 *  - Auto-discovery on account add
 */

import { useState, useCallback, useEffect, useRef } from 'react'
import { toast as sonnerToast } from 'sonner'
import { useSettingsStore } from '@/store/settingsStore'
import {
  serializeSettings,
  deserializeSettings,
  mergeSettings,
  resolveConflict,
  encodeBase64,
  deriveCalendarHomeUrl,
  dtstampToISO,
  getPrimaryAccountId,
  setPrimaryAccountId,
  getEtag,
  setEtag,
  touchLastModified,
  setLastSyncedAt,
  getLastSyncedAt,
  clearSyncKeys,
} from '@/lib/settingsSync'
import { createCalDAVClient } from '@/features/caldav/client/CalDAVClient'
import { getCredentialById } from '@/features/caldav/client/credentials'
import * as accountStorage from '@/features/caldav/sync/accountStorage'
import type { CalDAVAccount } from '@/features/caldav/types'

// ─── Toast helper ─────────────────────────────────────────────────────────────

function showToast(message: string): void {
  sonnerToast(message)
}

/**
 * Turn a raw sync error message into a short, user-facing toast string.
 * Mirrors the categories `formatSyncError` in GeneralSettings.tsx already
 * shows inline, so a failure is never purely silent — push() previously
 * only toasted on success, leaving failures visible solely in the settings
 * panel's inline error text (invisible if the user isn't looking at it,
 * e.g. background autosave-style pushes or auto-discovery on account add).
 */
function formatSyncErrorForToast(message: string): string {
  const lower = message.toLowerCase()
  if (lower.includes('cors') || lower.includes('cross-origin')) {
    return 'Settings sync failed: your server is blocking the connection (CORS).'
  }
  if (lower.includes('network') || lower.includes('fetch')) {
    return "Settings sync failed: couldn't reach your CalDAV server."
  }
  if (
    lower.includes('401') ||
    lower.includes('403') ||
    lower.includes('unauthorized') ||
    lower.includes('forbidden')
  ) {
    return 'Settings sync failed: authentication error. Check your CalDAV credentials.'
  }
  if (lower.includes('404') || lower.includes('not found')) {
    return 'Settings sync failed: settings calendar not found. Try disabling and re-enabling sync.'
  }
  return `Settings sync failed: ${message}`
}

function showErrorToast(message: string): void {
  sonnerToast.error(formatSyncErrorForToast(message))
}

// ─── Return type ──────────────────────────────────────────────────────────────

interface UseSettingsSyncReturn {
  enabled: boolean
  syncing: boolean
  lastSyncAt: string | null
  error: string | null
  accounts: CalDAVAccount[]
  enable: (accountId: string) => Promise<void>
  disable: (deleteRemote?: boolean) => Promise<void>
  push: () => Promise<void>
  pull: () => Promise<boolean>
  discoverSettings: (accountId: string) => Promise<void>
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useSettingsSync(): UseSettingsSyncReturn {
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [accounts, setAccounts] = useState<CalDAVAccount[]>([])
  const [, forceRender] = useState(0)

  const enabled = getPrimaryAccountId() !== null

  const isMountedRef = useRef(true)
  const inFlightRef = useRef(false)

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isMountedRef.current = false
    }
  }, [])

  // Load accounts on mount
  useEffect(() => {
    setAccounts(accountStorage.getAllAccounts())
  }, [])

  // ── Helpers ─────────────────────────────────────────────────────────────────

  async function resolveSettingsCalendarUrl(accountId: string): Promise<string | null> {
    const account = accountStorage.getAccountById(accountId)
    if (!account) return null
    const credential = await getCredentialById(account.credentialId)
    if (!credential) return null
    const client = await createCalDAVClient(account.serverUrl, credential, account.proxyUrl)
    const calendars = accountStorage.getCalendarsByAccountId(accountId)
    if (calendars.length === 0) return null
    const calendarHomeUrl = deriveCalendarHomeUrl(account.serverUrl, calendars[0].url)
    const discovered = await client.discoverSettingsCalendar(calendarHomeUrl)
    return discovered?.url ?? null
  }

  function resolveAndMerge(
    localSettings: ReturnType<typeof useSettingsStore.getState>,
    remoteSettings: {
      settings: Partial<ReturnType<typeof useSettingsStore.getState>>
      syncedAt: string
    },
    remoteDtstamp: string
  ): ReturnType<typeof useSettingsStore.getState> {
    const lastSynced = getLastSyncedAt() || '1970-01-01T00:00:00Z'
    const winner = resolveConflict(lastSynced, remoteDtstamp || remoteSettings.syncedAt)
    if (winner === 'remote') {
      return { ...localSettings, ...mergeSettings(localSettings, remoteSettings.settings) }
    }
    return localSettings
  }

  // ── Core operations ─────────────────────────────────────────────────────────

  // pull is defined before push so push can reference it in its dependency array.
  // Returns `true` when a remote settings payload was applied locally,
  // `false` when there was nothing to pull (empty server / parse error /
  // conflict lost). Callers use this to decide whether to surface
  // a "settings applied" message vs. a softer "calendar found" message.
  const pull = useCallback(async (): Promise<boolean> => {
    if (inFlightRef.current) return false
    const accountId = getPrimaryAccountId()
    if (!accountId) {
      setError('Sync not properly configured')
      return false
    }

    inFlightRef.current = true
    setSyncing(true)
    setError(null)
    try {
      const calUrl = await resolveSettingsCalendarUrl(accountId)
      if (!calUrl) {
        setError('Settings calendar not found')
        return false
      }

      const account = accountStorage.getAccountById(accountId)
      if (!account) {
        setError('Account not found')
        return false
      }
      const credential = await getCredentialById(account.credentialId)
      if (!credential) {
        setError('Credentials not found')
        return false
      }

      const client = await createCalDAVClient(account.serverUrl, credential, account.proxyUrl)
      const remote = await client.fetchSettingsEvent(calUrl)

      if (!remote) {
        if (useSettingsStore.getState().caldavDebugMode)
          console.warn('[SettingsSync] No remote settings event found — nothing to pull')
        return false
      }

      const json = client.extractSettingsFromVEVENT(remote.data)
      if (!json) {
        if (useSettingsStore.getState().caldavDebugMode)
          console.warn('[SettingsSync] Could not extract settings from remote VEVENT')
        return false
      }

      const parsed = deserializeSettings(json)
      if (!parsed) {
        if (useSettingsStore.getState().caldavDebugMode)
          console.warn('[SettingsSync] Remote settings payload invalid or unsupported version')
        return false
      }

      const dtstampIso = dtstampToISO(remote.dtstamp)
      const localSettings = useSettingsStore.getState()
      const merged = resolveAndMerge(localSettings, parsed, dtstampIso)
      useSettingsStore.getState().updateSettings(merged)
      setEtag(remote.etag)
      // Store the actual DTSTAMP from the server — shows when settings were truly last written
      setLastSyncedAt(dtstampIso || new Date().toISOString())
      if (isMountedRef.current) forceRender((n) => n + 1)
      return true
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Pull failed'
      console.error('[SettingsSync] Pull failed:', err)
      if (isMountedRef.current) setError(msg)
      return false
    } finally {
      inFlightRef.current = false
      setSyncing(false)
    }
  }, [])

  const push = useCallback(
    async (retryDepth = 0): Promise<void> => {
      if (inFlightRef.current) {
        if (useSettingsStore.getState().caldavDebugMode)
          console.warn('[SettingsSync] Push skipped — already in flight')
        return
      }
      const accountId = getPrimaryAccountId()
      if (!accountId) {
        setError('Sync not properly configured')
        return
      }

      inFlightRef.current = true
      setSyncing(true)
      setError(null)
      try {
        if (useSettingsStore.getState().caldavDebugMode)
          console.log('[SettingsSync] Push: resolving calendar URL...')
        const calUrl = await resolveSettingsCalendarUrl(accountId)
        if (!calUrl) {
          setError('Settings calendar not found')
          showErrorToast('Settings calendar not found')
          return
        }
        if (useSettingsStore.getState().caldavDebugMode)
          console.log('[SettingsSync] Push: calendar URL =', calUrl)

        const account = accountStorage.getAccountById(accountId)
        if (!account) {
          setError('Account not found')
          showErrorToast('Account not found')
          return
        }
        const credential = await getCredentialById(account.credentialId)
        if (!credential) {
          setError('Credentials not found')
          showErrorToast('Credentials not found')
          return
        }

        const client = await createCalDAVClient(account.serverUrl, credential, account.proxyUrl)
        const json = serializeSettings()
        const base64 = encodeBase64(json)
        const storedEtag = getEtag()
        if (useSettingsStore.getState().caldavDebugMode)
          console.log('[SettingsSync] Push: putting settings event, etag =', storedEtag)
        const newEtag = await client.putSettingsEvent(calUrl, base64, storedEtag ?? undefined)
        if (useSettingsStore.getState().caldavDebugMode)
          console.log('[SettingsSync] Push: success, new etag =', newEtag)
        if (newEtag) setEtag(newEtag)
        touchLastModified()
        setLastSyncedAt(new Date().toISOString())
        if (isMountedRef.current) {
          forceRender((n) => n + 1)
          showToast('Settings saved to server.')
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Push failed'
        console.error('[SettingsSync] Push failed:', err)
        if (isMountedRef.current) setError(msg)
        const is412 =
          msg.includes('412') || msg.includes('If-Match') || msg.includes('Precondition')
        let recovered = false
        if (retryDepth < 1 && is412) {
          if (useSettingsStore.getState().caldavDebugMode)
            console.log('[SettingsSync] Push: 412 detected, pulling then retrying...')
          // Temporarily release inFlightRef so pull() can run
          inFlightRef.current = false
          await pull()
          inFlightRef.current = true
          try {
            const calUrl = await resolveSettingsCalendarUrl(getPrimaryAccountId()!)
            const account = accountStorage.getAccountById(getPrimaryAccountId()!)
            if (calUrl && account) {
              const credential = await getCredentialById(account.credentialId)
              if (credential) {
                const client = await createCalDAVClient(
                  account.serverUrl,
                  credential,
                  account.proxyUrl
                )
                const base64 = encodeBase64(serializeSettings())
                const newEtag = await client.putSettingsEvent(
                  calUrl,
                  base64,
                  getEtag() || undefined
                )
                setEtag(newEtag)
                touchLastModified()
                if (isMountedRef.current) setError(null)
                recovered = true
              }
            }
          } catch {
            /* give up */
          }
        }
        // Only toast when the failure is final — a silently-recovered 412
        // retry shouldn't surface an error the user never actually hit.
        if (!recovered && isMountedRef.current) showErrorToast(msg)
      } finally {
        inFlightRef.current = false
        setSyncing(false)
      }
    },
    [pull]
  )

  // ── Enable / Disable ───────────────────────────────────────────────────────

  const enable = useCallback(
    async (accountId: string): Promise<void> => {
      setSyncing(true)
      setError(null)
      try {
        const account = accountStorage.getAccountById(accountId)
        if (!account) throw new Error('Account not found')
        const credential = await getCredentialById(account.credentialId)
        if (!credential) throw new Error('Credentials not found')

        const client = await createCalDAVClient(account.serverUrl, credential, account.proxyUrl)
        const calendars = accountStorage.getCalendarsByAccountId(accountId)
        if (calendars.length === 0) throw new Error('No calendars found')
        const calendarHomeUrl = deriveCalendarHomeUrl(account.serverUrl, calendars[0].url)

        const discovered = await client.discoverSettingsCalendar(calendarHomeUrl)
        let settingsCal = discovered
        let hasExistingSettings = false

        if (!settingsCal) {
          const newCalUrl = await client.createSettingsCalendar(calendarHomeUrl)
          settingsCal = { url: newCalUrl }
        } else {
          const existing = await client.fetchSettingsEvent(settingsCal.url)
          hasExistingSettings = !!existing
        }

        setPrimaryAccountId(accountId)

        if (hasExistingSettings) {
          await pull()
        } else {
          const json = serializeSettings()
          const base64 = encodeBase64(json)
          const newEtag = await client.putSettingsEvent(settingsCal!.url, base64, undefined, null)
          if (newEtag) setEtag(newEtag)
          touchLastModified()
        }

        // Mirrors the R1.22 fix in `discoverSettings`: only claim "settings
        // found" when a remote payload actually existed and was applied.
        // A pre-existing but empty settings calendar gets the softer wording;
        // a brand-new calendar (nothing discovered) keeps the generic message.
        const toastMessage = !discovered
          ? 'Settings sync enabled.'
          : hasExistingSettings
            ? 'Calino Settings found — sync enabled.'
            : 'Calino Settings calendar found — sync enabled.'
        showToast(toastMessage)
        if (isMountedRef.current) forceRender((n) => n + 1)
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to enable sync'
        console.error('[SettingsSync] Enable failed:', err)
        if (isMountedRef.current) setError(msg)
        clearSyncKeys()
        throw err
      } finally {
        setSyncing(false)
      }
    },
    [pull]
  )

  const disable = useCallback(async (deleteRemote: boolean = false): Promise<void> => {
    const accountId = getPrimaryAccountId()

    if (deleteRemote && accountId) {
      try {
        const calUrl = await resolveSettingsCalendarUrl(accountId)
        const account = accountStorage.getAccountById(accountId)
        if (calUrl && account) {
          const credential = await getCredentialById(account.credentialId)
          if (credential) {
            const client = await createCalDAVClient(account.serverUrl, credential, account.proxyUrl)
            await client.deleteSettingsCalendar(calUrl)
          }
        }
      } catch (err) {
        console.warn('[SettingsSync] Failed to delete remote calendar:', err)
      }
    }

    clearSyncKeys()
    if (isMountedRef.current) forceRender((n) => n + 1)
  }, [])

  // ── Auto-discovery on account add ──────────────────────────────────────────

  const discoverSettings = useCallback(
    async (accountId: string): Promise<void> => {
      if (getPrimaryAccountId()) return

      try {
        const account = accountStorage.getAccountById(accountId)
        if (!account) return
        const credential = await getCredentialById(account.credentialId)
        if (!credential) return

        const client = await createCalDAVClient(account.serverUrl, credential, account.proxyUrl)
        const calendars = accountStorage.getCalendarsByAccountId(accountId)
        if (calendars.length === 0) return
        const calendarHomeUrl = deriveCalendarHomeUrl(account.serverUrl, calendars[0].url)

        const discovered = await client.discoverSettingsCalendar(calendarHomeUrl)
        if (!discovered) return

        setPrimaryAccountId(accountId)
        // pull() returns `true` only when it actually applied a remote
        // payload. The collection may exist on the server while being
        // empty — that's a fresh-install case, and the user hasn't
        // actually had anything synced yet.
        const applied = await pull()
        if (isMountedRef.current) forceRender((n) => n + 1)

        showToast(
          applied
            ? 'Calino Settings found — sync enabled automatically.'
            : 'Calino Settings calendar found — sync enabled.'
        )
      } catch (err) {
        // Distinct from `discoverSettingsCalendar` returning null (no settings
        // calendar exists yet — a normal, silent no-op above). Reaching here
        // means an actual request failed, which previously only logged to the
        // console — the user had zero signal that auto-discovery broke.
        const msg = err instanceof Error ? err.message : 'Auto-discovery failed'
        console.warn('[SettingsSync] Auto-discovery failed:', err)
        if (isMountedRef.current) showErrorToast(msg)
      }
    },
    [pull]
  )

  return {
    enabled,
    syncing,
    lastSyncAt: getLastSyncedAt() || null,
    error,
    accounts,
    enable,
    disable,
    push,
    pull,
    discoverSettings,
  }
}
