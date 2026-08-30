import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { CalendarEvent } from '@/types'
import { LocationPicker } from '../LocationPicker'

function event(id: string, start: string, location: string): CalendarEvent {
  return {
    id,
    calendarId: 'calendar',
    title: id,
    start,
    end: start,
    isAllDay: false,
    location,
  }
}

describe('LocationPicker', () => {
  it('opens on focus with recent suggestions and exposes combobox semantics', () => {
    render(
      <LocationPicker
        value=""
        events={[event('recent', new Date().toISOString(), 'Recent room')]}
        onChange={vi.fn()}
        placeholder="Add a location"
      />
    )

    const input = screen.getByRole('combobox')
    expect(input).toHaveAttribute('aria-expanded', 'false')
    fireEvent.focus(input)

    const listbox = screen.getByRole('listbox')
    expect(input).toHaveAttribute('aria-expanded', 'true')
    expect(input).toHaveAttribute('aria-controls', listbox.id)
    expect(screen.getByRole('option', { name: 'Recent room' })).toBeInTheDocument()
  })

  it('navigates suggestions and selects with the keyboard', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <LocationPicker
        value=""
        events={[
          event('one', new Date().toISOString(), 'First room'),
          event('two', new Date(Date.now() - 60_000).toISOString(), 'Second room'),
        ]}
        onChange={onChange}
      />
    )

    const input = screen.getByRole('combobox')
    await user.click(input)
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}')

    expect(onChange).toHaveBeenCalledWith('Second room')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(input).toHaveAttribute('aria-expanded', 'false')
  })

  it('keeps arbitrary free text synchronized and closes on Escape or outside click', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    function Harness(): React.JSX.Element {
      const [value, setValue] = useState('')
      return (
        <LocationPicker
          value={value}
          events={[event('one', new Date().toISOString(), 'Known room')]}
          onChange={(next) => {
            onChange(next)
            setValue(next)
          }}
        />
      )
    }
    render(<Harness />)

    const input = screen.getByRole('combobox')
    await user.type(input, 'A new place')
    expect(onChange).toHaveBeenLastCalledWith('A new place')
    expect(input).toHaveValue('A new place')

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()

    await user.clear(input)
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('searches the full event history while typing', async () => {
    const user = userEvent.setup()
    function Harness(): React.JSX.Element {
      const [value, setValue] = useState('')
      return (
        <LocationPicker
          value={value}
          events={[event('old', '2020-01-01T00:00:00Z', 'Older venue')]}
          onChange={setValue}
        />
      )
    }
    render(<Harness />)

    await user.type(screen.getByRole('combobox'), 'older')
    expect(screen.getByRole('option', { name: 'Older venue' })).toBeInTheDocument()
  })
})
