import { describe, it, expect } from 'vitest'
import { isCleartextUrl } from '../insecureUrl'

describe('isCleartextUrl', () => {
  it('flags plain http servers', () => {
    expect(isCleartextUrl('http://calendar.calendar.svc.cluster.local:5232')).toBe(true)
    expect(isCleartextUrl('  http://192.168.1.10/dav  ')).toBe(true)
  })

  it('accepts https', () => {
    expect(isCleartextUrl('https://caldav.example.com/dav.php')).toBe(false)
  })

  it('exempts loopback, which never leaves the device', () => {
    expect(isCleartextUrl('http://localhost:5232')).toBe(false)
    expect(isCleartextUrl('http://127.0.0.1:5232')).toBe(false)
  })

  it('stays quiet while the field is empty or half-typed', () => {
    expect(isCleartextUrl('')).toBe(false)
    expect(isCleartextUrl('   ')).toBe(false)
    expect(isCleartextUrl('caldav.example.com')).toBe(false)
    expect(isCleartextUrl('htt')).toBe(false)
  })
})
