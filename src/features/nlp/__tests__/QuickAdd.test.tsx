import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QuickAdd } from '../components/QuickAdd';

describe('QuickAdd Component', () => {
  it('renders input field', () => {
    render(<QuickAdd onAdd={() => {}} />);
    expect(screen.getByPlaceholderText(/add event/i)).toBeInTheDocument();
  });

  it('shows Add Event button', () => {
    render(<QuickAdd onAdd={() => {}} />);
    expect(screen.getByRole('button', { name: /add event/i })).toBeDisabled();
  });

  it('enables button when input has content', async () => {
    const user = userEvent.setup();
    render(<QuickAdd onAdd={() => {}} />);
    
    const input = screen.getByPlaceholderText(/add event/i);
    await user.type(input, 'Meeting tomorrow at 2pm');
    
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /add event/i })).toBeEnabled();
    });
  });

  it('calls onAdd with parsed result when submitted', async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn();
    render(<QuickAdd onAdd={onAdd} />);
    
    const input = screen.getByPlaceholderText(/add event/i);
    await user.type(input, 'Meeting tomorrow at 2pm');
    
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /add event/i })).toBeEnabled();
    });
    
    await user.click(screen.getByRole('button', { name: /add event/i }));
    
    await waitFor(() => {
      expect(onAdd).toHaveBeenCalledTimes(1);
      expect(onAdd).toHaveBeenCalledWith(
        expect.objectContaining({
          title: expect.any(String),
        })
      );
    });
  });

  it('shows cancel button when onCancel is provided', () => {
    const onCancel = vi.fn();
    render(<QuickAdd onAdd={() => {}} onCancel={onCancel} />);
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
  });

  it('calls onCancel when cancel button is clicked', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(<QuickAdd onAdd={() => {}} onCancel={onCancel} />);
    
    await user.click(screen.getByRole('button', { name: /cancel/i }));
    
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('clears input after successful submission', async () => {
    const user = userEvent.setup();
    render(<QuickAdd onAdd={() => {}} />);
    
    const input = screen.getByPlaceholderText(/add event/i);
    await user.type(input, 'Meeting tomorrow at 2pm');
    
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /add event/i })).toBeEnabled();
    });
    
    await user.click(screen.getByRole('button', { name: /add event/i }));
    
    await waitFor(() => {
      expect(input).toHaveValue('');
    });
  });
});
