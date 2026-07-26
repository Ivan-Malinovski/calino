import { toast as sonner } from 'sonner'

export interface ShowToastOptions {
  onUndo?: () => void
  duration?: number
  linkText?: string
  onLinkClick?: () => void
}

/**
 * Show a transient notification.
 * Wraps sonner's `toast()` and adds an Undo action button when `onUndo` is
 * provided, or a generic action button when `linkText`/`onLinkClick` are set.
 * Undo takes precedence — when both are set, only the Undo button is shown.
 */
export function showToast(message: string, options?: ShowToastOptions): void {
  const opts: Parameters<typeof sonner>[1] = {
    duration: options?.duration,
  }

  if (options?.onUndo) {
    opts.action = {
      label: 'Undo',
      onClick: () => {
        options.onUndo?.()
      },
    }
  } else if (options?.linkText && options.onLinkClick) {
    opts.action = {
      label: options.linkText,
      onClick: () => {
        options.onLinkClick?.()
      },
    }
  }

  sonner(message, opts)
}

export function showBrokenEventsNotification(count: number): void {
  const message =
    count === 1
      ? 'Found 1 broken event with invalid dates.'
      : `Found ${count} broken events with invalid dates.`

  showToast(message, {
    duration: 8000,
    linkText: 'View',
    onLinkClick: () => {
      window.location.href = '/settings?tab=data'
    },
  })
}

export function showDuplicateUidNotification(count: number): void {
  const message =
    count === 1
      ? 'Found 1 set of events sharing a duplicate ID on your server.'
      : `Found ${count} sets of events sharing a duplicate ID on your server.`

  showToast(message, {
    duration: 8000,
    linkText: 'View',
    onLinkClick: () => {
      window.location.href = '/settings?tab=data'
    },
  })
}
