import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createLocalStorageMock } from '@/test/storageMock'
import { useCalendarStore } from '@/store/calendarStore'
import type { ServerSubscription } from '@/features/caldav/types'

vi.mock('../fetchWebcal', () => ({
  fetchWebcalIcs: vi.fn(),
  normalizeWebcalUrl: (url: string) => url.replace(/^webcals?:\/\//i, 'https://'),
}))
vi.mock('@/features/caldav/adapter/iCalendarAdapter', () => ({
  parseICALDataAsync: vi.fn().mockResolvedValue([]),
}))

import { fetchWebcalIcs } from '../fetchWebcal'
import { reconcileServerSubscriptions, removeServerSubscriptions } from '../serverSubscriptions'
import { getAllSubscriptions, saveSubscription } from '../subscriptionStorage'

const holidays: ServerSubscription = {
  url: 'https://dav.example.com/u/holidays/',
  name: 'Holidays',
  color: '#123456',
  source: 'https://example.com/holidays.ics',
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('reconcileServerSubscriptions (#237)', () => {
  const storage = createLocalStorageMock()

  beforeEach(() => {
    storage.install()
    useCalendarStore.setState({ calendars: [], events: [] })
    vi.mocked(fetchWebcalIcs).mockReset().mockResolvedValue('BEGIN:VCALENDAR\nEND:VCALENDAR')
  })

  afterEach(() => {
    storage.reset()
  })

  it('imports a server-held feed as a read-only webcal calendar and fetches it', async () => {
    reconcileServerSubscriptions('acc-1', [holidays], null)
    await flush()

    const [subscription] = getAllSubscriptions()
    expect(subscription).toMatchObject({
      url: 'https://example.com/holidays.ics',
      serverAccountId: 'acc-1',
      serverCollectionUrl: holidays.url,
    })
    expect(subscription.lastFetchedAt).not.toBeNull()
    const calendars = useCalendarStore.getState().calendars
    expect(calendars).toHaveLength(1)
    expect(calendars[0]).toMatchObject({
      id: subscription.calendarId,
      name: 'Holidays',
      source: 'webcal',
      readOnly: true,
    })
    expect(fetchWebcalIcs).toHaveBeenCalledWith('https://example.com/holidays.ics', null)
  })

  it('is idempotent across syncs', async () => {
    reconcileServerSubscriptions('acc-1', [holidays], null)
    reconcileServerSubscriptions('acc-1', [holidays], null)
    await flush()
    expect(getAllSubscriptions()).toHaveLength(1)
    expect(useCalendarStore.getState().calendars).toHaveLength(1)
  })

  it('records a feed that cannot be fetched without throwing', async () => {
    vi.mocked(fetchWebcalIcs).mockRejectedValue(new Error('blocked by CORS'))
    reconcileServerSubscriptions('acc-1', [holidays], null)
    await flush()
    expect(getAllSubscriptions()[0].lastError).toBe('blocked by CORS')
  })

  it('removes a subscription whose collection left the server', async () => {
    reconcileServerSubscriptions('acc-1', [holidays], null)
    await flush()
    reconcileServerSubscriptions('acc-1', [], null)
    expect(getAllSubscriptions()).toEqual([])
    expect(useCalendarStore.getState().calendars).toEqual([])
  })

  it('removes nothing when the listing failed (found === null)', async () => {
    reconcileServerSubscriptions('acc-1', [holidays], null)
    await flush()
    reconcileServerSubscriptions('acc-1', null, null)
    expect(getAllSubscriptions()).toHaveLength(1)
  })

  it('leaves a feed the user already subscribed to by hand alone', () => {
    saveSubscription({
      calendarId: 'manual',
      name: 'Mine',
      url: 'https://example.com/holidays.ics',
      refreshIntervalMinutes: 60,
    })
    reconcileServerSubscriptions('acc-1', [holidays], null)
    expect(getAllSubscriptions()).toHaveLength(1)
    expect(getAllSubscriptions()[0].serverAccountId).toBeUndefined()
  })

  it("only touches the given account's subscriptions", async () => {
    reconcileServerSubscriptions('acc-1', [holidays], null)
    reconcileServerSubscriptions('acc-2', [], null)
    await flush()
    expect(getAllSubscriptions()).toHaveLength(1)
  })

  it('removeServerSubscriptions drops everything mirrored from an account', async () => {
    reconcileServerSubscriptions('acc-1', [holidays], null)
    await flush()
    removeServerSubscriptions('acc-1')
    expect(getAllSubscriptions()).toEqual([])
  })

  it('follows a server-side rename and a changed feed URL', async () => {
    reconcileServerSubscriptions('acc-1', [holidays], null)
    await flush()
    reconcileServerSubscriptions(
      'acc-1',
      [{ ...holidays, name: 'Danish holidays', source: 'https://example.com/dk.ics' }],
      null
    )
    await flush()
    const [subscription] = getAllSubscriptions()
    expect(subscription.name).toBe('Danish holidays')
    expect(subscription.url).toBe('https://example.com/dk.ics')
    expect(useCalendarStore.getState().calendars[0].name).toBe('Danish holidays')
  })
})
