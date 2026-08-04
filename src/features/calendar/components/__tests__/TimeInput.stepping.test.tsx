import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { TimeInput } from '../TimeInput'

/**
 * Date fields adjust on scroll (via `useScrollInput`) and on arrow keys
 * (natively, being `<input type="date">`). The desktop time field is a
 * `type="text"` input, so it got neither — this wires both up in 15-minute
 * steps, matching the step `useScrollInput` uses for native time inputs.
 */
describe('TimeInput — scroll and arrow-key stepping', () => {
  const renderInput = (value = '09:00', timeFormat: '24h' | '12h' = '24h') => {
    const onChange = vi.fn()
    render(
      <TimeInput
        value={value}
        timeFormat={timeFormat}
        onChange={onChange}
        className="x"
        dataComponent="test-time"
        ariaLabel="Start time"
      />
    )
    return { input: screen.getByLabelText('Start time'), onChange }
  }

  // jsdom's fireEvent.wheel dispatches a real WheelEvent, which the component's
  // natively-attached listener picks up.
  const scroll = (el: Element, deltaY: number) => fireEvent.wheel(el, { deltaY })

  it('steps forward 15 minutes on ArrowUp', () => {
    const { input, onChange } = renderInput('09:00')
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    expect(onChange).toHaveBeenCalledWith('09:15')
  })

  it('steps back 15 minutes on ArrowDown', () => {
    const { input, onChange } = renderInput('09:00')
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(onChange).toHaveBeenCalledWith('08:45')
  })

  it('scrolling up steps forward, scrolling down steps back', () => {
    // Controlled, the way every real call site uses it: consecutive steps have
    // to build on the value the parent fed back, not on the initial one.
    const seen: string[] = []
    function Harness(): React.JSX.Element {
      const [value, setValue] = useState('09:00')
      return (
        <TimeInput
          value={value}
          timeFormat="24h"
          onChange={(next) => {
            seen.push(next)
            setValue(next)
          }}
          className="x"
          dataComponent="test-time"
          ariaLabel="Start time"
        />
      )
    }
    render(<Harness />)
    const input = screen.getByLabelText('Start time')

    scroll(input, -100)
    scroll(input, -100)
    scroll(input, 100)

    expect(seen).toEqual(['09:15', '09:30', '09:15'])
    expect((input as HTMLInputElement).value).toBe('09:15')
  })

  it('ignores wheel deltas too small to make a step', () => {
    const { input, onChange } = renderInput('09:00')
    scroll(input, 4)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('wraps backwards across midnight rather than producing a negative hour', () => {
    const { input, onChange } = renderInput('00:00')
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(onChange).toHaveBeenCalledWith('23:45')
  })

  it('wraps forwards across midnight', () => {
    const { input, onChange } = renderInput('23:45')
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    expect(onChange).toHaveBeenCalledWith('00:00')
  })

  it('emits 24h values while displaying 12h', () => {
    const { input, onChange } = renderInput('13:00', '12h')
    expect((input as HTMLInputElement).value).toBe('1:00 PM')

    fireEvent.keyDown(input, { key: 'ArrowUp' })
    expect(onChange).toHaveBeenCalledWith('13:15')
    expect((input as HTMLInputElement).value).toBe('1:15 PM')
  })

  it('steps from what was just typed, not the last committed value', () => {
    const { input, onChange } = renderInput('09:00')

    fireEvent.change(input, { target: { value: '11:30' } })
    onChange.mockClear()

    fireEvent.keyDown(input, { key: 'ArrowUp' })
    expect(onChange).toHaveBeenCalledWith('11:45')
  })

  it('does not let arrow keys reach handlers outside the field', () => {
    const onOuterKeyDown = vi.fn()
    const onChange = vi.fn()
    render(
      <div onKeyDown={onOuterKeyDown}>
        <TimeInput
          value="09:00"
          timeFormat="24h"
          onChange={onChange}
          className="x"
          dataComponent="test-time"
          ariaLabel="Start time"
        />
      </div>
    )

    fireEvent.keyDown(screen.getByLabelText('Start time'), { key: 'ArrowUp' })
    expect(onChange).toHaveBeenCalledWith('09:15')
    expect(onOuterKeyDown).not.toHaveBeenCalled()
  })

  it('still blurs on Enter', () => {
    const { input } = renderInput('09:00')
    input.focus()
    expect(document.activeElement).toBe(input)

    fireEvent.keyDown(input, { key: 'Enter' })
    expect(document.activeElement).not.toBe(input)
  })
})
