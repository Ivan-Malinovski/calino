import { useOverdueTaskBadge } from '@/hooks/useOverdueTaskBadge'

/**
 * Hosts the overdue-task badge for the whole app. It sits above the router
 * rather than inside the calendar, because the badge must follow the setting
 * even while the Settings page — where it is switched on and off — is showing.
 */
export default function OverdueTaskBadge(): null {
  useOverdueTaskBadge()
  return null
}
