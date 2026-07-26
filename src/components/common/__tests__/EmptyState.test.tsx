import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { EmptyState } from '../EmptyState'

describe('EmptyState', () => {
  it('renders title and description', () => {
    render(<EmptyState title="Nothing here" description="Create your first thing." />)
    expect(screen.getByRole('heading', { name: /nothing here/i })).toBeInTheDocument()
    expect(screen.getByText(/create your first thing\./i)).toBeInTheDocument()
  })

  it('omits description when not provided', () => {
    render(<EmptyState title="Just a title" />)
    expect(screen.getByRole('heading', { name: /just a title/i })).toBeInTheDocument()
  })

  it('renders the icon when provided', () => {
    const { container } = render(
      <EmptyState icon={<span data-testid="my-icon">📅</span>} title="Empty" />
    )
    expect(screen.getByTestId('my-icon')).toBeInTheDocument()
    // icon should be hidden from assistive tech
    expect(container.querySelector('[aria-hidden="true"]')).toBeInTheDocument()
  })

  it('renders an action element when provided', () => {
    render(<EmptyState title="Empty" action={<button type="button">Do the thing</button>} />)
    expect(screen.getByRole('button', { name: /do the thing/i })).toBeInTheDocument()
  })

  it('uses role="status" so screen readers announce changes', () => {
    const { container } = render(<EmptyState title="Empty" />)
    expect(container.querySelector('[role="status"]')).toBeInTheDocument()
  })
})
