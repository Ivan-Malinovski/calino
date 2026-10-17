import { describe, it, expect } from 'vitest'
import { formatDateInput, parseDateInput } from '../datetime'

describe('formatDateInput', () => {
  it('renders in each configured order', () => {
    expect(formatDateInput('2026-10-17', 'dd/MM/yyyy')).toBe('17/10/2026')
    expect(formatDateInput('2026-10-17', 'MM/dd/yyyy')).toBe('10/17/2026')
    expect(formatDateInput('2026-10-17', 'yyyy-MM-dd')).toBe('2026-10-17')
  })

  it('leaves empty and non-date values alone', () => {
    expect(formatDateInput('', 'dd/MM/yyyy')).toBe('')
    expect(formatDateInput('soon', 'dd/MM/yyyy')).toBe('soon')
  })

  it('ignores a time suffix', () => {
    expect(formatDateInput('2026-10-17T09:00:00', 'dd/MM/yyyy')).toBe('17/10/2026')
  })
})

describe('parseDateInput', () => {
  it('reads each configured order back to yyyy-MM-dd', () => {
    expect(parseDateInput('17/10/2026', 'dd/MM/yyyy')).toBe('2026-10-17')
    expect(parseDateInput('10/17/2026', 'MM/dd/yyyy')).toBe('2026-10-17')
    expect(parseDateInput('2026-10-17', 'yyyy-MM-dd')).toBe('2026-10-17')
  })

  it('accepts other separators and missing leading zeros', () => {
    expect(parseDateInput('7.3.2026', 'dd/MM/yyyy')).toBe('2026-03-07')
    expect(parseDateInput('2026/3/7', 'yyyy-MM-dd')).toBe('2026-03-07')
  })

  it('rejects impossible and malformed dates', () => {
    expect(parseDateInput('31/02/2026', 'dd/MM/yyyy')).toBeNull()
    expect(parseDateInput('13/01/2026', 'MM/dd/yyyy')).toBeNull()
    expect(parseDateInput('17/10/26', 'dd/MM/yyyy')).toBeNull()
    expect(parseDateInput('', 'dd/MM/yyyy')).toBeNull()
  })

  it('round-trips a leap day', () => {
    expect(parseDateInput(formatDateInput('2028-02-29', 'MM/dd/yyyy'), 'MM/dd/yyyy')).toBe(
      '2028-02-29'
    )
  })
})
