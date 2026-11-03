export interface WebcalSubscription {
  id: string
  calendarId: string
  name: string
  // Normalized https:// form — webcal:// is rewritten at add-time.
  url: string
  refreshIntervalMinutes: number
  proxyUrl?: string | null
  lastFetchedAt: string | null
  lastError: string | null
  // True for subscriptions defined in calino.config.json — hidden from
  // edit/delete in the settings UI, same as preconfigured CalDAV accounts.
  isPreconfigured?: boolean
  // Set when the subscription mirrors a collection a CalDAV server holds as an
  // external-feed subscription (Radicale VSUBSCRIBED). The server owns it, so
  // the settings UI treats it like a preconfigured one: no edit URL / remove.
  serverAccountId?: string
  serverCollectionUrl?: string
}
