import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Modal } from '../Modal'

describe('Modal', () => {
  it('renders children when open', () => {
    render(
      <Modal isOpen={true} onClose={() => {}}>
        <p>Modal content</p>
      </Modal>
    )
    expect(screen.getByText(/modal content/i)).toBeInTheDocument()
  })

  it('does not render when closed', () => {
    render(
      <Modal isOpen={false} onClose={() => {}}>
        <p>Modal content</p>
      </Modal>
    )
    expect(screen.queryByText(/modal content/i)).not.toBeInTheDocument()
  })

  it('renders with title', () => {
    render(
      <Modal isOpen={true} onClose={() => {}} title="Test Modal">
        <p>Content</p>
      </Modal>
    )
    expect(screen.getByText('Test Modal')).toBeInTheDocument()
  })

  it('calls onClose when overlay is clicked', async () => {
    const user = userEvent.setup()
    const handleClose = vi.fn()

    render(
      <Modal isOpen={true} onClose={handleClose}>
        <p>Content</p>
      </Modal>
    )

    const overlay = screen.getByRole('dialog').parentElement
    if (overlay) {
      await user.click(overlay)
    }

    expect(handleClose).toHaveBeenCalledTimes(1)
  })

  it('does not call onClose when modal content is clicked', async () => {
    const user = userEvent.setup()
    const handleClose = vi.fn()

    render(
      <Modal isOpen={true} onClose={handleClose}>
        <p>Content</p>
      </Modal>
    )

    await user.click(screen.getByText(/content/i))

    expect(handleClose).not.toHaveBeenCalled()
  })

  it('calls onClose when Escape key is pressed', async () => {
    const user = userEvent.setup()
    const handleClose = vi.fn()

    render(
      <Modal isOpen={true} onClose={handleClose}>
        <p>Content</p>
      </Modal>
    )

    await user.keyboard('{Escape}')

    expect(handleClose).toHaveBeenCalledTimes(1)
  })

  it('has correct ARIA attributes', () => {
    render(
      <Modal isOpen={true} onClose={() => {}} title="Accessible Modal">
        <p>Content</p>
      </Modal>
    )

    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAttribute('aria-labelledby', 'modal-title')
  })

  it('applies custom className', () => {
    render(
      <Modal isOpen={true} onClose={() => {}} className="custom-modal">
        <p>Content</p>
      </Modal>
    )

    expect(screen.getByRole('dialog')).toHaveClass('custom-modal')
  })

  it('closes on close button click', async () => {
    const user = userEvent.setup()
    const handleClose = vi.fn()

    render(
      <Modal isOpen={true} onClose={handleClose} title="Test">
        <p>Content</p>
      </Modal>
    )

    await user.click(screen.getByRole('button', { name: /close/i }))

    expect(handleClose).toHaveBeenCalledTimes(1)
  })
})
