import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import { Sidebar } from '../components/Sidebar'
import { useCalendarStore } from '@/store/calendarStore'

function renderWithRouter(component: React.ReactElement) {
  return render(<BrowserRouter>{component}</BrowserRouter>)
}

describe('Sidebar calendar rename', () => {
  beforeEach(() => {
    const store = useCalendarStore.getState()
    store.events.forEach((e) => store.deleteEvent(e.id))
    store.calendars.forEach((c) => store.deleteCalendar(c.id))
  })

  it('persists a local calendar rename (double-click + Enter)', () => {
    useCalendarStore.getState().addCalendar({
      id: 'local-1', name: 'My Local Cal', color: '#4285F4',
      isVisible: true, isDefault: true, showTasksInViews: true,
    })
    renderWithRouter(<Sidebar />)
    fireEvent.click(screen.getByRole('button', { name: /^calendars/i }))
    fireEvent.doubleClick(screen.getByText('My Local Cal'))
    const input = screen.getByDisplayValue('My Local Cal') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'Renamed Cal' } })
    act(() => { fireEvent.keyDown(input, { key: 'Enter' }) })
    expect(
      useCalendarStore.getState().calendars.find((c) => c.id === 'local-1')?.name
    ).toBe('Renamed Cal')
  })

  it('keeps a CalDAV calendar rename even when the server push fails', async () => {
    // CalDAV calendar present in the store but with no reachable account, so
    // the server PROPPATCH throws. The local rename must NOT be rolled back.
    useCalendarStore.getState().addCalendar({
      id: 'caldav-1', name: 'Work', color: '#4285F4',
      isVisible: true, isDefault: false, accountId: 'acct-1', showTasksInViews: true,
    })
    renderWithRouter(<Sidebar />)
    fireEvent.click(screen.getByRole('button', { name: /^calendars/i }))
    fireEvent.doubleClick(screen.getByText('Work'))
    const input = screen.getByDisplayValue('Work') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'Job' } })
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' })
      await Promise.resolve()
    })
    await waitFor(() => {
      expect(
        useCalendarStore.getState().calendars.find((c) => c.id === 'caldav-1')?.name
      ).toBe('Job')
    })
  })
})
