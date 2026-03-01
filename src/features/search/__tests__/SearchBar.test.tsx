import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SearchBar } from '../components/SearchBar'

describe('SearchBar', () => {
  const defaultProps = {
    value: '',
    onChange: vi.fn(),
    onClear: vi.fn(),
    onOpen: vi.fn(),
    onClose: vi.fn(),
    isOpen: false,
  }

  it('renders search input with placeholder', () => {
    render(<SearchBar {...defaultProps} placeholder="Search events..." />)

    const input = screen.getByPlaceholderText('Search events...')
    expect(input).toBeInTheDocument()
  })

  it('calls onChange when input changes', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(<SearchBar {...defaultProps} onChange={onChange} />)

    const input = screen.getByRole('textbox')
    await user.type(input, 'meeting')

    expect(onChange).toHaveBeenCalledTimes(7)
  })

  it('shows clear button when value is not empty', () => {
    render(<SearchBar {...defaultProps} value="meeting" />)

    const clearButton = screen.getByRole('button', { name: /clear search/i })
    expect(clearButton).toBeInTheDocument()
  })

  it('hides clear button when value is empty', () => {
    render(<SearchBar {...defaultProps} value="" />)

    expect(screen.queryByRole('button', { name: /clear search/i })).not.toBeInTheDocument()
  })

  it('calls onClear when clear button is clicked', async () => {
    const user = userEvent.setup()
    const onClear = vi.fn()

    render(<SearchBar {...defaultProps} value="meeting" onClear={onClear} />)

    const clearButton = screen.getByRole('button', { name: /clear search/i })
    await user.click(clearButton)

    expect(onClear).toHaveBeenCalledTimes(1)
  })

  it('shows shortcut hint when search is closed', () => {
    render(<SearchBar {...defaultProps} isOpen={false} value="" />)

    expect(screen.getByText('⌘K')).toBeInTheDocument()
  })

  it('shows Esc hint when search is open', () => {
    render(<SearchBar {...defaultProps} isOpen={true} value="" />)

    expect(screen.getByText('Esc')).toBeInTheDocument()
  })

  it('has accessible label', () => {
    render(<SearchBar {...defaultProps} />)

    const input = screen.getByLabelText('Search events')
    expect(input).toBeInTheDocument()
  })

  it('calls onClose when Escape is pressed', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()

    render(<SearchBar {...defaultProps} isOpen={true} onClose={onClose} />)

    const input = screen.getByRole('textbox')
    await user.type(input, '{Escape}')

    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
