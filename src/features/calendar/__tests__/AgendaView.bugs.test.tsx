import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { AgendaView } from '../components/AgendaView'
import styles from '../components/AgendaView.module.css'

vi.mock('@/store/calendarStore', () => ({
  useCalendarStore: vi.fn((selector) => {
    const state = {
      currentDate: '2024-03-15',
      calendars: [{ id: 'cal1', name: 'Calendar 1', color: '#4285F4', isVisible: true }],
      categories: [],
      events: [],
      getEventsForDateRange: vi.fn(() => []),
      openModal: vi.fn(),
      openPreview: vi.fn(),
      previewEventId: null,
      closePreview: vi.fn(),
      deleteEvent: vi.fn(),
    }
    return selector(state as never)
  }),
}))

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: vi.fn((selector) => {
    return selector({ timeFormat: '12h' })
  }),
}))

vi.mock('@/store/contextMenuStore', () => ({
  useContextMenuStore: vi.fn((selector) => {
    const state = {
      openMenuId: null,
      openMenu: vi.fn(),
      closeMenu: vi.fn(),
    }
    return selector(state as never)
  }),
}))

vi.mock('@/features/caldav/hooks/useCalDAV', () => ({
  useCalDAV: vi.fn(() => ({
    deleteEvent: vi.fn(),
  })),
}))

describe('Bug #75: AgendaView embedded prop', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders without crashing', () => {
    const { container } = render(<AgendaView />)
    expect(container.firstChild).toBeTruthy()
  })

  it('renders without crashing when embedded is true', () => {
    const { container } = render(<AgendaView embedded={true} />)
    expect(container.firstChild).toBeTruthy()
  })

  it('applies embedded class when embedded prop is true', () => {
    const { container } = render(<AgendaView embedded={true} />)
    const rootEl = container.firstChild as HTMLElement
    expect(rootEl.className).toContain(styles.embedded)
  })

  it('does not apply embedded class when embedded prop is false', () => {
    const { container } = render(<AgendaView embedded={false} />)
    const rootEl = container.firstChild as HTMLElement
    expect(rootEl.className).not.toContain(styles.embedded)
  })

  it('does not apply embedded class by default', () => {
    const { container } = render(<AgendaView />)
    const rootEl = container.firstChild as HTMLElement
    expect(rootEl.className).not.toContain(styles.embedded)
  })
})
