import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
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
})
