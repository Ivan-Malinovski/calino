import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CommandPalette } from '../components/CommandPalette'

vi.mock('@/store/calendarStore', () => ({
  useCalendarStore: vi.fn((selector) => {
    const state = {
      events: [],
      calendars: [
        { id: 'cal1', name: 'Calendar 1', color: '#4285F4', isVisible: true, isDefault: true },
      ],
      addEvent: vi.fn(),
      setCurrentDate: vi.fn(),
      setCurrentView: vi.fn(),
      openModal: vi.fn(),
    }
    return selector(state as never)
  }),
}))

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: vi.fn((selector) => {
    return selector({ timeFormat: '12h' })
  }),
}))

vi.mock('../hooks/useCommandPalette', () => ({
  useCommandPalette: vi.fn(() => ({
    query: '',
    setQuery: vi.fn(),
    results: [
      {
        type: 'command',
        item: {
          id: 'nav-today',
          label: 'Go to Today',
          category: 'navigation',
          keywords: ['today'],
          action: () => 'Done',
        },
        score: 1,
      },
      {
        type: 'command',
        item: {
          id: 'view-month',
          label: 'Switch to Month View',
          category: 'navigation',
          keywords: ['month'],
          action: () => 'Done',
        },
        score: 0.8,
      },
    ],
    selectedIndex: 0,
    setSelectedIndex: vi.fn(),
    handleKeyDown: vi.fn(),
    executeSelected: vi.fn().mockReturnValue({ success: true, message: 'Navigated to today' }),
  })),
}))

describe('CommandPalette', () => {
  it('renders input with placeholder', () => {
    render(<CommandPalette isOpen={true} onClose={vi.fn()} />)

    expect(screen.getByPlaceholderText(/search commands/i)).toBeInTheDocument()
  })

  it('does not render when isOpen is false', () => {
    const { container } = render(<CommandPalette isOpen={false} onClose={vi.fn()} />)

    expect(container.firstChild).toBeNull()
  })

  it('renders results when open', () => {
    render(<CommandPalette isOpen={true} onClose={vi.fn()} />)

    expect(screen.getByText('Go to Today')).toBeInTheDocument()
    expect(screen.getByText('Switch to Month View')).toBeInTheDocument()
  })

  it('displays category labels', () => {
    render(<CommandPalette isOpen={true} onClose={vi.fn()} />)

    expect(screen.getByText('Navigation')).toBeInTheDocument()
  })

  it('calls onClose when Escape is pressed', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()

    render(<CommandPalette isOpen={true} onClose={onClose} />)

    const input = screen.getByRole('textbox')
    await user.type(input, '{Escape}')

    expect(onClose).toHaveBeenCalled()
  })

  it('shows shortcut hint when empty', () => {
    render(<CommandPalette isOpen={true} onClose={vi.fn()} />)

    expect(screen.getAllByText('Esc').length).toBeGreaterThan(0)
  })
})
