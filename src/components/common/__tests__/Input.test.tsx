import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Input } from '../Input'

describe('Input', () => {
  it('renders input element', () => {
    render(<Input />)
    expect(screen.getByRole('textbox')).toBeInTheDocument()
  })

  it('renders with label when name is provided', () => {
    render(<Input name="username" label="Username" />)
    expect(screen.getByLabelText(/username/i)).toBeInTheDocument()
  })

  it('renders with label when id is provided', () => {
    render(<Input id="password" label="Password" />)
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument()
  })

  it('handles value changes', async () => {
    const user = userEvent.setup()
    const handleChange = vi.fn()

    render(<Input onChange={handleChange} />)

    await user.type(screen.getByRole('textbox'), 'hello')

    expect(handleChange).toHaveBeenCalled()
  })

  it('shows error message', () => {
    render(<Input error="This field is required" />)
    expect(screen.getByText(/this field is required/i)).toBeInTheDocument()
  })

  it('applies error class when error is present', () => {
    render(<Input error="Error" />)
    const input = screen.getByRole('textbox')
    const hasErrorClass = Array.from(input.classList).some((cls) => cls.includes('hasError'))
    expect(hasErrorClass).toBe(true)
  })

  it('accepts placeholder text', () => {
    render(<Input placeholder="Enter your name" />)
    expect(screen.getByPlaceholderText(/enter your name/i)).toBeInTheDocument()
  })

  it('can be disabled', () => {
    render(<Input disabled />)
    expect(screen.getByRole('textbox')).toBeDisabled()
  })

  it('can be read-only', () => {
    render(<Input readOnly value="Read only" />)
    expect(screen.getByRole('textbox')).toHaveAttribute('readonly')
  })

  it('applies custom className', () => {
    render(<Input className="custom-input" />)
    expect(screen.getByRole('textbox')).toHaveClass('custom-input')
  })

  it('accepts type prop', () => {
    render(<Input type="email" />)
    expect(screen.getByRole('textbox')).toHaveAttribute('type', 'email')
  })

  it('accepts required prop', () => {
    render(<Input required />)
    expect(screen.getByRole('textbox')).toHaveAttribute('required')
  })
})
