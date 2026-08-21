import { describe, it, expect } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { useRef } from 'react'
import { useRovingGrid } from '../useRovingGrid'

function Harness() {
  const gridRef = useRef<HTMLDivElement>(null)
  const { handleKeyDown } = useRovingGrid(gridRef, '[data-cell]', (key) =>
    key === 'ArrowLeft' ? -1 : key === 'ArrowRight' ? 1 : key === 'ArrowUp' ? -3 : key === 'ArrowDown' ? 3 : null
  )
  return (
    <div>
      <div ref={gridRef} data-testid="grid" onKeyDown={handleKeyDown}>
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} data-cell={i} tabIndex={i === 0 ? 0 : -1}>
            cell-{i}
          </div>
        ))}
      </div>
      <button data-testid="outside">outside</button>
    </div>
  )
}

describe('useRovingGrid', () => {
  it('moves focus right by the delta and advances the roving tab stop', () => {
    const { getByTestId } = render(<Harness />)
    const grid = getByTestId('grid')
    const cells = Array.from(grid.querySelectorAll<HTMLElement>('[data-cell]'))
    cells[1].focus()

    fireEvent.keyDown(grid, { key: 'ArrowRight' })

    expect(document.activeElement).toBe(cells[2])
    expect(cells[1].tabIndex).toBe(-1)
    expect(cells[2].tabIndex).toBe(0)
  })

  it('moves focus up by the row delta', () => {
    const { getByTestId } = render(<Harness />)
    const grid = getByTestId('grid')
    const cells = Array.from(grid.querySelectorAll<HTMLElement>('[data-cell]'))
    cells[4].focus()

    fireEvent.keyDown(grid, { key: 'ArrowUp' })

    expect(document.activeElement).toBe(cells[1])
  })

  it('ignores non-arrow keys so other handlers keep working', () => {
    const { getByTestId } = render(<Harness />)
    const grid = getByTestId('grid')
    const cells = Array.from(grid.querySelectorAll<HTMLElement>('[data-cell]'))
    cells[1].focus()

    fireEvent.keyDown(grid, { key: 'Enter' })

    expect(document.activeElement).toBe(cells[1])
  })

  it('does not move when the focus is not on a grid cell', () => {
    const { getByTestId } = render(<Harness />)
    const grid = getByTestId('grid')
    const cells = Array.from(grid.querySelectorAll<HTMLElement>('[data-cell]'))
    const outside = getByTestId('outside')
    outside.focus()

    fireEvent.keyDown(grid, { key: 'ArrowRight' })

    expect(document.activeElement).toBe(outside)
    expect(cells[0].tabIndex).toBe(0)
  })

  it('leaves the roving tab stop on the first cell when focus starts elsewhere', () => {
    const { getByTestId } = render(<Harness />)
    const grid = getByTestId('grid')
    const cells = Array.from(grid.querySelectorAll<HTMLElement>('[data-cell]'))
    cells[0].focus()

    fireEvent.keyDown(grid, { key: 'ArrowRight' })
    fireEvent.keyDown(grid, { key: 'ArrowRight' })

    expect(document.activeElement).toBe(cells[2])
    expect(cells[2].tabIndex).toBe(0)
  })

  it('marks the grid edge on the container so callers can page', () => {
    const { getByTestId } = render(<Harness />)
    const grid = getByTestId('grid')
    const cells = Array.from(grid.querySelectorAll<HTMLElement>('[data-cell]'))
    cells[5].focus()

    fireEvent.keyDown(grid, { key: 'ArrowRight' })

    expect(grid.dataset.rovingAtEdge).toBe('ArrowRight')
    // Focus stays put at the edge and the tab stop is untouched.
    expect(document.activeElement).toBe(cells[5])
    expect(cells[0].tabIndex).toBe(0)
  })
})
