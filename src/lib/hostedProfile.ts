const OWNER_KEY = 'calino.hostedProfile'

// An existing local profile must never be silently adopted by a hosted user.
const DATA_KEYS = [
  'calino-storage',
  'calino-contacts',
  'calino-ai-vision-settings',
  'calino-smart-defaults',
  'calino-snoozed-reminders',
  'calino_caldav_accounts',
  'calino_caldav_calendars',
  'calino_caldav_credentials',
  'calino_pending_changes',
  'calino_webcal_subscriptions',
  'calino.masterPassword',
]

const CALINO_DATABASES = new Set(['calino-raw-ics', 'calino-attachments', 'calino-contact-photos'])

export function getHostedProfile(): string | null {
  try {
    return localStorage.getItem(OWNER_KEY)
  } catch {
    return null
  }
}

export async function bindHostedProfile(
  verifiedUser: string
): Promise<'ok' | 'unavailable' | 'otherProfile'> {
  try {
    // Serialize claims from tabs opened before a profile has been assigned.
    return await navigator.locks.request(OWNER_KEY, async () => {
      const owner = localStorage.getItem(OWNER_KEY)
      if (owner !== null) return owner === verifiedUser ? 'ok' : 'otherProfile'

      if (DATA_KEYS.some((key) => localStorage.getItem(key) !== null)) return 'otherProfile'
      const databases = await indexedDB.databases()
      if (databases.some(({ name }) => name && CALINO_DATABASES.has(name))) return 'otherProfile'

      localStorage.setItem(OWNER_KEY, verifiedUser)
      return 'ok'
    })
  } catch {
    return 'unavailable'
  }
}
