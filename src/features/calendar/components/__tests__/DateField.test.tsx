import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { DateField } from '../DateField'
import { useSettingsStore } from '@/store/settingsStore'

function setup(value = '2026-10-17') {
  useSettingsStore.setState({ dateFormat: 'dd/MM/yyyy' })
  const onChange = vi.fn()
  render(<DateField value={value} onChange={onChange} ariaLabel="Due" />)
  return { input: screen.getByLabelText('Due') as HTMLInputElement, onChange }
}

describe('DateField', () => {
  it('shows the stored date in the configured format', () => {
    const { input } = setup()
    expect(input.value).toBe('17/10/2026')
  })

  it('reports typed dates as yyyy-MM-dd', () => {
    const { input, onChange } = setup()
    fireEvent.change(input, { target: { value: '05/11/2026' } })
    expect(onChange).toHaveBeenCalledWith('2026-11-05')
  })

  it('steps a day with the arrow keys', () => {
    const { input, onChange } = setup()
    fireEvent.keyDown(input, { key: 'ArrowUp' })
    expect(onChange).toHaveBeenLastCalledWith('2026-10-18')
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(onChange).toHaveBeenLastCalledWith('2026-10-16')
  })

  it('steps a day with the mouse wheel while focused, scrolling up for later', () => {
    const { input, onChange } = setup()
    input.focus()
    fireEvent.wheel(input, { deltaY: -100 })
    expect(onChange).toHaveBeenLastCalledWith('2026-10-18')
    fireEvent.wheel(input, { deltaY: 100 })
    expect(onChange).toHaveBeenLastCalledWith('2026-10-16')
  })

  it('ignores the wheel when unfocused or for sub-notch deltas', () => {
    const { input, onChange } = setup()
    fireEvent.wheel(input, { deltaY: -100 })
    input.focus()
    fireEvent.wheel(input, { deltaY: 3 })
    expect(onChange).not.toHaveBeenCalled()
  })
})
