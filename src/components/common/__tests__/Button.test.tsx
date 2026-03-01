import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Button } from '../Button'

describe('Button', () => {
  it('renders with children', () => {
    render(<Button>Click me</Button>)
    expect(screen.getByRole('button', { name: /click me/i })).toBeInTheDocument()
  })

  it('renders primary variant button', () => {
    render(<Button variant="primary">Primary</Button>)
    const button = screen.getByRole('button')
    expect(button.textContent).toBe('Primary')
  })

  it('renders secondary variant button', () => {
    render(<Button variant="secondary">Secondary</Button>)
    expect(screen.getByRole('button').textContent).toBe('Secondary')
  })

  it('renders ghost variant button', () => {
    render(<Button variant="ghost">Ghost</Button>)
    expect(screen.getByRole('button').textContent).toBe('Ghost')
  })

  it('renders small size button', () => {
    render(<Button size="sm">Small</Button>)
    expect(screen.getByRole('button').textContent).toBe('Small')
  })

  it('renders medium size button', () => {
    render(<Button size="md">Medium</Button>)
    expect(screen.getByRole('button').textContent).toBe('Medium')
  })

  it('renders large size button', () => {
    render(<Button size="lg">Large</Button>)
    expect(screen.getByRole('button').textContent).toBe('Large')
  })

  it('calls onClick when clicked', async () => {
    const user = userEvent.setup()
    const handleClick = vi.fn()

    render(<Button onClick={handleClick}>Click me</Button>)

    await user.click(screen.getByRole('button'))

    expect(handleClick).toHaveBeenCalledTimes(1)
  })

  it('can be disabled', () => {
    render(<Button disabled>Disabled</Button>)
    expect(screen.getByRole('button')).toBeDisabled()
  })

  it('applies custom className', () => {
    render(<Button className="custom-class">Custom</Button>)
    expect(screen.getByRole('button')).toHaveClass('custom-class')
  })

  it('can be focused and receives focus', async () => {
    const user = userEvent.setup()
    render(<Button>Focusable</Button>)

    await user.tab()
    expect(screen.getByRole('button')).toHaveFocus()
  })
})
