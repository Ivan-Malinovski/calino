import { useEffect, useRef } from 'react'
import type { CalDAVAccount } from '../types'
import { createCalendarBackend } from '../client/createBackend'
import { getCredentialById } from '../client/credentials'

const PUSH_DEBOUNCE_MS = 1500

/**
 * Keeps JMAP accounts live: opens the server's EventSource stream for each one
 * and runs the normal account sync (debounced) when it reports a change. CalDAV
 * accounts have no push, so they are untouched. Own writes echo back as a state
 * change; the resulting sync is cheap because the event cursor is unchanged.
 */
export function useJmapPush(
  accounts: CalDAVAccount[],
  syncAccount: (accountId: string) => Promise<void>
): void {
  const syncRef = useRef(syncAccount)
  useEffect(() => {
    syncRef.current = syncAccount
  }, [syncAccount])

  const jmapKey = accounts
    .filter((account) => account.protocol === 'jmap')
    .map((account) => account.id)
    .join(',')

  useEffect(() => {
    if (!jmapKey) return
    let cancelled = false
    const stops: Array<() => void> = []
    const timers = new Map<string, ReturnType<typeof setTimeout>>()

    for (const accountId of jmapKey.split(',')) {
      void (async () => {
        try {
          const account = accounts.find((candidate) => candidate.id === accountId)
          const credential = account && (await getCredentialById(account.credentialId))
          if (!account || !credential || cancelled) return
          const backend = await createCalendarBackend(
            account.serverUrl,
            credential,
            account.proxyUrl,
            account.protocol
          )
          if (cancelled || !backend.watch) return
          stops.push(
            backend.watch(() => {
              clearTimeout(timers.get(accountId))
              timers.set(
                accountId,
                setTimeout(() => {
                  if (!cancelled && navigator.onLine) syncRef.current(accountId).catch(() => {})
                }, PUSH_DEBOUNCE_MS)
              )
            })
          )
        } catch {
          // Push is an optimisation; regular syncs still run.
        }
      })()
    }

    return () => {
      cancelled = true
      for (const stop of stops) stop()
      for (const timer of timers.values()) clearTimeout(timer)
    }
    // `accounts` is read once per key change; the key already captures which accounts matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jmapKey])
}
