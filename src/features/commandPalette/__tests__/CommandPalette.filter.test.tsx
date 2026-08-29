import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { CommandPalette } from '../components/CommandPalette'
import type { CommandPaletteFilter } from '../lib/eventFilters'

const palette = vi.hoisted(() => ({
  query: 'Roadmap',
  isFilterMode: false,
  isFilterFormVisible: false,
  filter: {
    terms: [],
    includedTerms: [],
    location: '',
    excludedKeywords: [],
    fromDate: undefined,
    toDate: undefined,
  } as CommandPaletteFilter,
  items: [
    {
      id: 'event-1',
      value: 'Roadmap planning',
      group: 'event',
      keywords: [],
      onSelect: vi.fn().mockResolvedValue({ success: true, message: '' }),
      data: {
        id: 'event-1',
        title: 'Roadmap planning',
        start: '2026-08-10T09:00:00.000Z',
        calendarId: 'cal1',
        type: 'event',
        description: 'Discuss the next release',
        location: 'Copenhagen office',
        calendarName: 'Work',
        calendarColor: '#4285F4',
        highlightTerms: ['Roadmap'],
      },
      itemType: 'event',
    },
  ],
  resetPalette: vi.fn(),
  enterFilterMode: vi.fn(),
  toggleFilterForm: vi.fn(),
  setIncludedTerms: vi.fn(),
  setLocation: vi.fn(),
  setExcludedKeywords: vi.fn(),
  setFromDate: vi.fn(),
  setToDate: vi.fn(),
  resetFilters: vi.fn(),
  filteredResultCount: 1,
  activeFilterCount: 1,
  invalidDateRange: false,
}))

vi.mock('@/store/calendarStore', () => ({
  useCalendarStore: vi.fn((selector) =>
    selector({
      events: [],
      calendars: [{ id: 'cal1', name: 'Work', color: '#4285F4' }],
    } as never)
  ),
}))

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: vi.fn((selector) => selector({ timeFormat: '24h', language: 'en' })),
}))

vi.mock('../hooks/useCommandPalette', () => ({
  useCommandPalette: vi.fn(() => {
    const [query, setQuery] = useState(palette.query)
    const [filter, setFilter] = useState(palette.filter)
    const [isFilterMode, setIsFilterMode] = useState(palette.isFilterMode)
    const [isFilterFormVisible, setIsFilterFormVisible] = useState(
      palette.isFilterFormVisible
    )

    const enterFilterMode = (): void => {
      palette.enterFilterMode()
      setFilter((current) =>
        query.trim() && current.terms.length === 0
          ? { ...current, terms: [query.trim()] }
          : current
      )
      setQuery('')
      setIsFilterMode(true)
      setIsFilterFormVisible(true)
    }
    const toggleFilterForm = (): void => {
      palette.toggleFilterForm()
      setIsFilterFormVisible((visible) => !visible)
    }
    const setIncludedTerms = (terms: string[]): void => {
      palette.setIncludedTerms(terms)
      setFilter((current) => ({ ...current, terms }))
    }
    const setLocation = (location: string): void => {
      palette.setLocation(location)
      setFilter((current) => ({ ...current, location }))
    }

    return {
      ...palette,
      query,
      setQuery,
      filter,
      isFilterMode,
      isFilterFormVisible,
      enterFilterMode,
      toggleFilterForm,
      setIncludedTerms,
      setLocation,
    }
  }),
}))

describe('CommandPalette filter mode', () => {
  beforeEach(() => {
    palette.query = 'Roadmap'
    palette.isFilterMode = false
    palette.isFilterFormVisible = false
    palette.filter = {
      terms: [],
      includedTerms: [],
      location: '',
      excludedKeywords: [],
      fromDate: undefined,
      toDate: undefined,
    }
    palette.resetPalette.mockClear()
    palette.enterFilterMode.mockClear()
    palette.toggleFilterForm.mockClear()
    palette.setIncludedTerms.mockClear()
    palette.setLocation.mockClear()
  })

  it('hands the current query into the first included term', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<CommandPalette isOpen onClose={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Filter events' }))
    rerender(<CommandPalette isOpen onClose={vi.fn()} />)

    expect(screen.getByRole('heading', { name: /filter events/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Hide filters' })).toHaveAttribute(
      'data-open',
      'true'
    )
    expect(screen.getByRole('combobox', { name: /command palette/i })).toHaveAttribute(
      'aria-readonly',
      'true'
    )
    expect(document.querySelector('[data-component="command-palette-chip"]')).toHaveTextContent(
      'Roadmap'
    )
    expect(document.activeElement).toBe(screen.getByLabelText('Include terms'))
  })

  it('opens and collapses filters with the keyboard without closing the palette', async () => {
    const { rerender } = render(<CommandPalette isOpen onClose={vi.fn()} />)
    const toggle = screen.getByRole('button', { name: 'Filter events' })

    fireEvent.keyDown(toggle, { key: 'Enter' })
    fireEvent.click(toggle)
    rerender(<CommandPalette isOpen onClose={vi.fn()} />)

    expect(screen.getByRole('heading', { name: /filter events/i })).toBeInTheDocument()
    const hide = screen.getByRole('button', { name: 'Hide filters' })
    fireEvent.keyDown(hide, { key: 'Enter' })
    fireEvent.click(hide)
    rerender(<CommandPalette isOpen onClose={vi.fn()} />)

    expect(screen.queryByRole('heading', { name: /filter events/i })).toBeNull()
    expect(screen.getByRole('button', { name: 'Filter events' })).toHaveAttribute(
      'data-open',
      'false'
    )
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('adds comma-separated chips and keeps Enter inside the form', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<CommandPalette isOpen onClose={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Filter events' }))
    rerender(<CommandPalette isOpen onClose={vi.fn()} />)

    const include = screen.getByLabelText('Include terms')
    await user.type(include, 'planning, team')
    await user.keyboard('{Enter}')
    rerender(<CommandPalette isOpen onClose={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'Remove included term team' })).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('turns a pasted comma-separated value into separate chips', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<CommandPalette isOpen onClose={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Filter events' }))
    rerender(<CommandPalette isOpen onClose={vi.fn()} />)

    const include = screen.getByLabelText('Include terms')
    fireEvent.change(include, { target: { value: 'planning,team,release' } })

    expect(
      screen.getByRole('button', { name: 'Remove included term planning' })
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove included term team' })).toBeInTheDocument()
  })

  it('deduplicates repeated tokens within one draft', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<CommandPalette isOpen onClose={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Filter events' }))
    rerender(<CommandPalette isOpen onClose={vi.fn()} />)

    const include = screen.getByLabelText('Include terms')
    await user.type(include, 'planning planning')
    await user.keyboard('{Enter}')
    rerender(<CommandPalette isOpen onClose={vi.fn()} />)

    expect(
      screen.getByRole('button', { name: 'Remove included term planning' })
    ).toBeInTheDocument()
  })

  it('collapses only the form while filtered results remain visible', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<CommandPalette isOpen onClose={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Filter events' }))
    rerender(<CommandPalette isOpen onClose={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Hide filters' }))
    rerender(<CommandPalette isOpen onClose={vi.fn()} />)

    expect(document.querySelector('[data-component="command-palette-filters"]')).toBeNull()
    expect(screen.getByRole('option', { name: /Roadmap planning/ })).toBeInTheDocument()
  })
})
