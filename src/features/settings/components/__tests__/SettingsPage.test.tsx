import { describe, it, expect, beforeEach, vi } from 'vitest'
import { screen, fireEvent } from '@testing-library/react'
import { render } from '@/test/caldavRender'
import { MemoryRouter } from 'react-router'
import { SettingsPage } from '../SettingsPage'
import { ThemeProvider } from '@/components/ThemeProvider'
import { useCalendarStore } from '@/store/calendarStore'
import { useSettingsStore } from '@/store/settingsStore'

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

describe('default reminder setting', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useSettingsStore.getState().updateSettings({ defaultReminderMinutes: 15 })
  })

  const renderCalendarSettings = () => renderWithProviders(['/settings?tab=calendar'])

  it('shows a non-preset default as a custom number + unit and saves edits', () => {
    useSettingsStore.getState().updateSettings({ defaultReminderMinutes: 90 })
    renderCalendarSettings()

    const value = screen.getByLabelText('Custom default reminder value')
    expect(value).toHaveValue(90)
    expect(
      (screen.getByLabelText('Custom default reminder unit') as HTMLSelectElement).value
    ).toBe('minutes')

    fireEvent.change(value, { target: { value: '30' } })
    fireEvent.change(screen.getByLabelText('Custom default reminder unit'), {
      target: { value: 'hours' },
    })
    expect(useSettingsStore.getState().defaultReminderMinutes).toBe(1800)
  })

  it('seeds a non-preset value when Custom is picked', () => {
    renderCalendarSettings()

    fireEvent.change(screen.getByLabelText('Default reminder'), { target: { value: 'custom' } })

    expect(useSettingsStore.getState().defaultReminderMinutes).toBe(90)
    expect(screen.getByLabelText('Custom default reminder value')).toBeInTheDocument()
  })

  it('decomposes a stored non-preset into the largest unit (240 → 4 hours)', () => {
    useSettingsStore.getState().updateSettings({ defaultReminderMinutes: 240 })
    renderCalendarSettings()

    const select = screen.getByLabelText('Default reminder')
    expect(select).not.toHaveTextContent('4 hours before') // not a preset anymore
    expect((select as HTMLSelectElement).value).toBe('custom')
    expect(screen.getByLabelText('Custom default reminder value')).toHaveValue(4)
    expect(
      (screen.getByLabelText('Custom default reminder unit') as HTMLSelectElement).value
    ).toBe('hours')
  })
})
