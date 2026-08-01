import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { DayEventsPopup } from '../DayEventsPopup'
import type { CalendarEvent } from '@/types'

const POPUP_WIDTH = 300
const POPUP_HEIGHT = 360

function makeEvents(count: number): CalendarEvent[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `e${i}`,
    title: `Event ${i}`,
    start: '2026-08-01T09:00:00',
    end: '2026-08-01T10:00:00',
    calendarId: 'default',
  })) as CalendarEvent[]
}

function renderAt(position: { x: number; y: number }): HTMLElement {
  render(
    <DayEventsPopup
      date={new Date('2026-08-01T00:00:00')}
      events={makeEvents(8)}
      position={position}
      onClose={vi.fn()}
      onEventClick={vi.fn()}
    />
  )
  return screen.getByRole('dialog')
}

describe('DayEventsPopup placement', () => {
  beforeEach(() => {
    // jsdom lays nothing out, so the popup gets a size of its own to be
    // clamped against.
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
      configurable: true,
      get: () => POPUP_WIDTH,
    })
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get: () => POPUP_HEIGHT,
    })
    window.innerWidth = 1000
    window.innerHeight = 700
  })

  afterEach(() => {
    // @ts-expect-error restoring jsdom's own zero-size getters
    delete HTMLElement.prototype.offsetWidth
    // @ts-expect-error restoring jsdom's own zero-size getters
    delete HTMLElement.prototype.offsetHeight
  })

  it('leaves a popup that already fits where the day put it', () => {
    const popup = renderAt({ x: 120, y: 80 })
    expect(popup.style.left).toBe('120px')
    expect(popup.style.top).toBe('80px')
  })

  it('pulls a popup opened near the right edge back on screen', () => {
    // A Saturday cell in a 1000px window: 900 + 300 wide would run 200px off.
    const popup = renderAt({ x: 900, y: 80 })
    expect(popup.style.left).toBe('692px')
  })

  it('pulls a popup opened in the last week row back on screen', () => {
    const popup = renderAt({ x: 120, y: 640 })
    expect(popup.style.top).toBe('332px')
  })

  it('never pushes the popup off the opposite edge to fit it', () => {
    window.innerWidth = 200
    window.innerHeight = 200
    const popup = renderAt({ x: 180, y: 180 })
    expect(popup.style.left).toBe('8px')
    expect(popup.style.top).toBe('8px')
  })

  it('caps the height to the window so a long list scrolls instead', () => {
    window.innerHeight = 300
    const popup = renderAt({ x: 120, y: 40 })
    expect(popup.style.maxHeight).toBe('284px')
  })

  it('re-clamps when the window is resized under it', () => {
    const popup = renderAt({ x: 600, y: 80 })
    expect(popup.style.left).toBe('600px')

    window.innerWidth = 700
    act(() => {
      window.dispatchEvent(new Event('resize'))
    })
    expect(popup.style.left).toBe('392px')
  })
})
