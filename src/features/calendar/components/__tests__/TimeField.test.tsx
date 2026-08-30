import { describe, it, expect, beforeEach, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TimeField } from '../TimeField'
import { useIsMobile } from '@/hooks/useIsMobile'

vi.mock('@/hooks/useIsMobile', () => ({
  useIsMobile: vi.fn(),
}))
vi.mock('@/hooks/useScrollInput', () => ({
  useScrollInput: vi.fn(),
}))

describe('TimeField', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders TimeInput on desktop', () => {
    ;(useIsMobile as unknown as ReturnType<typeof vi.fn>).mockReturnValue(false)
    render(
      <TimeField
        value="09:00"
        timeFormat="24h"
        onChange={() => {}}
        dataComponent="x"
        ariaLabel="X"
      />
    )
    const input = screen.getByLabelText('X')
    expect(input).toHaveAttribute('type', 'text')
    expect(input).toBeRequired()
  })

  it('renders <input type="time"> on mobile', () => {
    ;(useIsMobile as unknown as ReturnType<typeof vi.fn>).mockReturnValue(true)
    render(
      <TimeField
        value="09:00"
        timeFormat="24h"
        onChange={() => {}}
        dataComponent="x"
        ariaLabel="X"
      />
    )
    const input = screen.getByLabelText('X')
    expect(input).toHaveAttribute('type', 'time')
    // Native time inputs in browsers blank out the value when `required` and
    // empty — see TimeField.tsx — so the mobile branch hardcodes required=false.
    expect(input).not.toBeRequired()
  })

  it('opens a quarter-hour list and selects with the keyboard', async () => {
    ;(useIsMobile as unknown as ReturnType<typeof vi.fn>).mockReturnValue(false)
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <TimeField
        value="09:00"
        timeFormat="24h"
        onChange={onChange}
        dataComponent="x"
        ariaLabel="X"
      />
    )

    const input = screen.getByRole('combobox')
    await user.click(input)

    const listbox = screen.getByRole('listbox')
    expect(input).toHaveAttribute('aria-expanded', 'true')
    expect(listbox).toHaveAttribute('id', input.getAttribute('aria-controls'))
    expect(screen.getAllByRole('option')).toHaveLength(96)

    await user.keyboard('{ArrowDown}{Enter}')

    expect(onChange).toHaveBeenCalledWith('09:15')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('selects a time with the pointer and closes on Escape or outside click', async () => {
    ;(useIsMobile as unknown as ReturnType<typeof vi.fn>).mockReturnValue(false)
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <TimeField
        value="12:00"
        timeFormat="24h"
        onChange={onChange}
        dataComponent="x"
        ariaLabel="X"
      />
    )

    const input = screen.getByRole('combobox')
    await user.click(input)
    await user.click(screen.getByRole('option', { name: '12:15' }))
    expect(onChange).toHaveBeenCalledWith('12:15')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()

    await user.click(input)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()

    await user.click(input)
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('keeps a non-quarter-hour typed time and commits it on blur', async () => {
    ;(useIsMobile as unknown as ReturnType<typeof vi.fn>).mockReturnValue(false)
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <TimeField
        value="09:00"
        timeFormat="24h"
        onChange={onChange}
        dataComponent="x"
        ariaLabel="X"
      />
    )

    const input = screen.getByRole('combobox')
    await user.click(input)
    await user.keyboard('09:07')
    expect(input).toHaveValue('09:07')
    fireEvent.blur(input)
    expect(input).toHaveValue('09:07')
    expect(onChange).toHaveBeenCalledWith('09:07')
  })
})
