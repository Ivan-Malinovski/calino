import type { CalendarEvent } from '@/types'
import { useCalendarStore } from '@/store/calendarStore'
import { detectClientFromProdid } from '@/lib/taskClientHint'
import { showToast } from '@/lib/toast'
import i18n from '@/lib/i18n'

/**
 * R2.8: calendars already offered rolling mode this session. The persisted
 * `rollingPromptDismissed` flag covers "Not now"; this covers a toast that was
 * just ignored, so ticking off several repeats in a row asks only once.
 */
const offeredThisSession = new Set<string>()

/** Test hook: forget which calendars were offered this session. */
export function resetRollingPromptSession(): void {
  offeredThisSession.clear()
}

/**
 * Offer rolling completion for `task`'s calendar, if its tasks look like they
 * are edited by a client that cannot read RECURRENCE-ID overrides (see
 * `taskClientHint`).
 *
 * Called right after a repeat is completed in the default override shape,
 * which is the one moment the choice matters. Asking on page load instead
 * would pop a toast over whatever the user is doing in any view. This only
 * ever asks: the mode changes when the user accepts, never on the hint alone.
 */
export function offerRollingCompletion(task: CalendarEvent): void {
  const calendarId = task.calendarId
  if (offeredThisSession.has(calendarId)) return

  const { calendars, events, updateCalendar } = useCalendarStore.getState()
  const calendar = calendars.find((item) => item.id === calendarId)
  if (!calendar || calendar.readOnly) return
  if (calendar.taskCompletionMode === 'rolling' || calendar.rollingPromptDismissed) return

  let client: string | null = task.clientProdid ? detectClientFromProdid(task.clientProdid) : null
  if (!client) {
    for (const event of events) {
      if (event.type !== 'task' || event.calendarId !== calendarId || !event.clientProdid) continue
      client = detectClientFromProdid(event.clientProdid)
      if (client) break
    }
  }
  if (!client) return

  offeredThisSession.add(calendarId)
  showToast(
    i18n.t('calendar:rollingPrompt.message', {
      client,
      defaultValue: `This list looks like it is edited by ${client}. Complete recurring tasks by moving the due date forward?`,
    }),
    {
      // One toast per calendar, even if two completions race.
      id: `rolling-prompt-${calendarId}`,
      duration: 20000,
      linkText: i18n.t('calendar:rollingPrompt.accept', {
        defaultValue: 'Use rolling completion',
      }),
      onLinkClick: () => updateCalendar(calendarId, { taskCompletionMode: 'rolling' }),
      cancelText: i18n.t('calendar:rollingPrompt.dismiss', { defaultValue: 'Not now' }),
      onCancelClick: () => updateCalendar(calendarId, { rollingPromptDismissed: true }),
    }
  )
}
