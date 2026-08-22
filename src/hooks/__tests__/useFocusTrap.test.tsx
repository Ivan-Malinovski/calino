import { describe, it, expect } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { useRef } from 'react'
import { useFocusTrap } from '../useFocusTrap'

function TrapHarness({ active }: { active: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  useFocusTrap(ref, active)
  return (
    <div>
      <button data-testid="outside">outside</button>
      <div ref={ref}>
        <button data-testid="first">first</button>
        <button data-testid="middle">middle</button>
        <button data-testid="last">last</button>
      </div>
    </div>
  )
}

function HiddenDescendantHarness({ active }: { active: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  useFocusTrap(ref, active)
  return (
    <div ref={ref}>
      <button data-testid="visible">visible</button>
      <div aria-hidden="true">
        <button data-testid="hidden">hidden</button>
      </div>
      <button data-testid="last-visible">last visible</button>
    </div>
  )
}

describe('useFocusTrap', () => {
  it('moves focus into the container when activated', () => {
    const { getByTestId } = render(<TrapHarness active />)
    expect(document.activeElement).toBe(getByTestId('first'))
  })

  it('wraps Tab from the last element back to the first', () => {
    const { getByTestId } = render(<TrapHarness active />)
    const last = getByTestId('last')
    last.focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(getByTestId('first'))
  })

  it('wraps Shift+Tab from the first element to the last', () => {
    const { getByTestId } = render(<TrapHarness active />)
    const first = getByTestId('first')
    first.focus()
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(getByTestId('last'))
  })

  it('restores focus to the previously-focused element on deactivation', () => {
    const { getByTestId, rerender } = render(<TrapHarness active={false} />)
    const outside = getByTestId('outside')
    outside.focus()
    expect(document.activeElement).toBe(outside)

    rerender(<TrapHarness active />)
    expect(document.activeElement).toBe(getByTestId('first'))

    rerender(<TrapHarness active={false} />)
    expect(document.activeElement).toBe(outside)
  })

  it('ignores focusable descendants of hidden ancestors', () => {
    const { getByTestId } = render(<HiddenDescendantHarness active />)
    const lastVisible = getByTestId('last-visible')
    const visible = getByTestId('visible')

    lastVisible.focus()
    fireEvent.keyDown(document, { key: 'Tab' })

    expect(document.activeElement).toBe(visible)
  })
})
