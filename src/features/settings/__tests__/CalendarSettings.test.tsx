import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CalendarSettings } from '../components/CalendarSettings'
import { useSettingsStore } from '@/store/settingsStore'

describe('CalendarSettings', () => {
  beforeEach(() => {
    useSettingsStore.setState({
      defaultView: 'month',
      showWeekNumbers: true,
      eventDensity: 'comfortable',
      compactRecurringEvents: true,
      compressPastWeeks: true,
    })
  })

  it('renders calendar settings', () => {
    render(<CalendarSettings />)

    expect(screen.getByText('Calendar')).toBeInTheDocument()
    expect(screen.getByText('Default View')).toBeInTheDocument()
    expect(screen.getByText('Show Week Numbers')).toBeInTheDocument()
    expect(screen.getByText('Event Display Density')).toBeInTheDocument()
  })

  it('toggles compact recurring events', async () => {
    const user = userEvent.setup()
    render(<CalendarSettings />)

    const compactToggle = screen.getByLabelText('Compact recurring events')

    expect(compactToggle).toBeChecked()

    await user.click(compactToggle)

    expect(useSettingsStore.getState().compactRecurringEvents).toBe(false)
  })

  it('toggles compress past weeks', async () => {
    const user = userEvent.setup()
    render(<CalendarSettings />)

    const compressToggle = screen.getByLabelText('Compact past weeks')

    expect(compressToggle).toBeChecked()

    await user.click(compressToggle)

    expect(useSettingsStore.getState().compressPastWeeks).toBe(false)
  })

  it('toggles secondary timezone and selects timezone and label', async () => {
    const user = userEvent.setup()
    useSettingsStore.setState({
      secondaryTimezoneEnabled: false,
      secondaryTimezone: null,
      secondaryTimezoneLabel: null,
    })

    render(<CalendarSettings />)

    const toggle = screen.getByLabelText('Show secondary timezone')
    expect(toggle).not.toBeChecked()

    // Enable secondary timezone
    await user.click(toggle)
    expect(useSettingsStore.getState().secondaryTimezoneEnabled).toBe(true)
    expect(useSettingsStore.getState().secondaryTimezone).toBe('UTC')

    // Dropdown should now be visible
    const select = screen.getByLabelText('Secondary timezone')
    expect(select).toBeInTheDocument()

    // Select America/New_York
    await user.selectOptions(select, 'America/New_York')
    expect(useSettingsStore.getState().secondaryTimezone).toBe('America/New_York')

    // Set custom label
    const labelInput = screen.getByLabelText('Secondary timezone label')
    await user.type(labelInput, 'NYC')
    expect(useSettingsStore.getState().secondaryTimezoneLabel).toBe('NYC')

    // Clear label -> persists as null
    await user.clear(labelInput)
    expect(useSettingsStore.getState().secondaryTimezoneLabel).toBeNull()
  })
})
