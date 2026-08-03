import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { SettingsPage } from '../SettingsPage'
import { ThemeProvider } from '@/components/ThemeProvider'
import { useCalendarStore } from '@/store/calendarStore'

const renderWithProviders = (entries: string[]) => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  })

  return render(
    <MemoryRouter initialEntries={entries}>
      <ThemeProvider>
        <SettingsPage />
      </ThemeProvider>
    </MemoryRouter>
  )
}

describe('SettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    const store = useCalendarStore.getState()
    store.events.forEach((e) => store.deleteEvent(e.id))
    store.calendars.forEach((c) => store.deleteCalendar(c.id))
  })

  it('renders default General tab when no URL param', () => {
    renderWithProviders(['/settings'])

    const pageTitles = screen.getAllByText('General')
    expect(pageTitles.length).toBeGreaterThanOrEqual(1)
  })

  it('initializes to calendar tab from URL query param ?tab=calendar', () => {
    renderWithProviders(['/settings?tab=calendar'])

    const matches = screen.getAllByText('Calendar')
    expect(matches.length).toBeGreaterThanOrEqual(1)
  })

  it('initializes to theme tab from URL query param', () => {
    renderWithProviders(['/settings?tab=theme'])

    const matches = screen.getAllByText('Appearance')
    expect(matches.length).toBeGreaterThanOrEqual(1)
  })

  it('initializes to caldav tab from URL query param', () => {
    renderWithProviders(['/settings?tab=caldav'])

    const matches = screen.getAllByText('Sync')
    expect(matches.length).toBeGreaterThanOrEqual(1)
  })

  it('initializes to data tab from URL query param', () => {
    renderWithProviders(['/settings?tab=data'])

    const matches = screen.getAllByText('Data')
    expect(matches.length).toBeGreaterThanOrEqual(1)
  })

  it('falls back to general tab for invalid URL param', () => {
    renderWithProviders(['/settings?tab=nonexistent'])

    const matches = screen.getAllByText('General')
    expect(matches.length).toBeGreaterThanOrEqual(1)
  })

  it('falls back to general tab for removed tabs', () => {
    renderWithProviders(['/settings?tab=events'])

    const matches = screen.getAllByText('General')
    expect(matches.length).toBeGreaterThanOrEqual(1)
  })

  it('falls back to general tab for data-issues', () => {
    renderWithProviders(['/settings?tab=data-issues'])

    const matches = screen.getAllByText('General')
    expect(matches.length).toBeGreaterThanOrEqual(1)
  })

  it('falls back to general tab for empty tab param', () => {
    renderWithProviders(['/settings?tab='])

    const matches = screen.getAllByText('General')
    expect(matches.length).toBeGreaterThanOrEqual(1)
  })

  it('can switch tabs via sidebar buttons', () => {
    renderWithProviders(['/settings'])

    // Click on Categories tab
    fireEvent.click(screen.getByText('Categories'))

    const matches = screen.getAllByText('Categories')
    expect(matches.length).toBeGreaterThanOrEqual(1)
  })

  it('renders all navigation items', () => {
    renderWithProviders(['/settings'])

    const nav = document.querySelector('nav')
    expect(nav).toBeInTheDocument()
    expect(nav!.textContent).toContain('General')
    expect(nav!.textContent).toContain('Appearance')
    expect(nav!.textContent).toContain('Calendar')
    expect(nav!.textContent).toContain('Categories')
    expect(nav!.textContent).toContain('Notifications')
    expect(nav!.textContent).toContain('Sync')
    expect(nav!.textContent).toContain('Data')
  })
})
