import { format } from 'date-fns'
import type { CalendarAttendee, CalendarEvent, CalendarOrganizer } from '@/types'
import { toEventInstant, getDateFnsLocale } from '@/lib/datetime'
import i18n from '@/lib/i18n'

/**
 * Windows' shell and several mail clients silently truncate long `mailto:`
 * URIs. 2000 characters is the commonly cited safe ceiling, so the body is
 * trimmed to fit rather than being handed over to be cut mid-word.
 */
export const MAILTO_MAX_LENGTH = 2000

/** Shortest description worth including once everything else has its space. */
const MIN_DESCRIPTION_CHARS = 40

function formatWhen(event: CalendarEvent, use24Hour: boolean): string {
  try {
    const start = toEventInstant(event.start, event.timezone)
    const end = toEventInstant(event.end, event.timezone)
    if (Number.isNaN(start.getTime())) return ''

    const locale = getDateFnsLocale()
    const dayText = (d: Date): string => format(d, 'EEEE, d MMMM yyyy', { locale })
    const timePattern = use24Hour ? 'HH:mm' : 'h:mm a'
    const timeText = (d: Date): string => format(d, timePattern, { locale })
    const dayAndTime = (d: Date): string =>
      i18n.t('calendar:ui.mailto.dateAtTime', { date: dayText(d), time: timeText(d) })

    if (event.isAllDay) {
      const allDay = (text: string): string => i18n.t('calendar:ui.mailto.allDay', { date: text })
      const startDay = dayText(start)
      if (Number.isNaN(end.getTime())) return startDay
      const endDay = dayText(end)
      return startDay === endDay ? allDay(startDay) : allDay(`${startDay} – ${endDay}`)
    }

    const startText = dayAndTime(start)
    if (Number.isNaN(end.getTime())) return startText

    // Same-day events only need the clock time on the far side.
    return format(start, 'yyyy-MM-dd') === format(end, 'yyyy-MM-dd')
      ? `${startText} – ${timeText(end)}`
      : `${startText} – ${dayAndTime(end)}`
  } catch {
    return ''
  }
}

export interface InviteOptions {
  /** Defaults to 24-hour, matching the app's own default. */
  use24Hour?: boolean
  /** Excluded from the recipient list — you don't invite yourself. */
  selfEmail?: string
}

/** Plain-text invitation body. Deliberately readable in any mail client. */
export function formatInviteBody(event: CalendarEvent, options: InviteOptions = {}): string {
  const { use24Hour = true } = options
  const lines: string[] = []

  lines.push(
    i18n.t('calendar:ui.mailto.invitedTo', {
      title: event.title || i18n.t('calendar:ui.mailto.untitled'),
    })
  )
  lines.push('')

  const when = formatWhen(event, use24Hour)
  if (when) lines.push(i18n.t('calendar:ui.mailto.when', { value: when }))
  if (event.location) lines.push(i18n.t('calendar:ui.mailto.where', { value: event.location }))
  if (event.url) lines.push(i18n.t('calendar:ui.mailto.link', { value: event.url }))
  if (event.organizer?.email) {
    lines.push(
      i18n.t('calendar:ui.mailto.organizer', {
        value: event.organizer.name
          ? `${event.organizer.name} <${event.organizer.email}>`
          : event.organizer.email,
      })
    )
  }

  const others = (event.attendees ?? []).map((a) => a.name || a.email)
  if (others.length > 0)
    lines.push(i18n.t('calendar:ui.mailto.attendees', { value: others.join(', ') }))

  if (event.description) {
    lines.push('')
    lines.push(event.description)
  }

  lines.push('')
  lines.push(i18n.t('calendar:ui.mailto.reply'))

  return lines.join('\n')
}

export interface MailtoResult {
  uri: string
  /** Recipients actually addressed, after self-exclusion and deduplication. */
  recipients: string[]
  /** True when the description had to be cut to stay under the length cap. */
  truncated: boolean
}

/**
 * Build an RFC 6068 `mailto:` URI for an event's attendees.
 *
 * Returns `null` when there is nobody to write to — callers should hide the
 * affordance rather than open an empty compose window.
 */
export function buildMailtoUri(
  event: CalendarEvent,
  attendees: CalendarAttendee[] = event.attendees ?? [],
  organizer: CalendarOrganizer | undefined = event.organizer,
  options: InviteOptions = {}
): MailtoResult | null {
  const self = options.selfEmail?.trim().toLowerCase()

  const recipients = [...new Set(attendees.map((a) => a.email.trim()).filter(Boolean))].filter(
    (email) => email.toLowerCase() !== self
  )

  if (recipients.length === 0) return null

  const eventForBody: CalendarEvent = { ...event, organizer, attendees }
  const when = formatWhen(event, options.use24Hour ?? true)
  const title = event.title || i18n.t('calendar:ui.mailto.untitled')
  const subject = when
    ? i18n.t('calendar:ui.mailto.subject', { title, when })
    : i18n.t('calendar:ui.mailto.subjectNoWhen', { title })

  const build = (body: string): string =>
    `mailto:${recipients.map(encodeURIComponent).join(',')}` +
    `?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`

  const fullBody = formatInviteBody(eventForBody, options)
  let uri = build(fullBody)
  let truncated = false

  if (uri.length > MAILTO_MAX_LENGTH && event.description) {
    // Only the description is negotiable — the when/where lines are the point
    // of the message. Shrink it until the whole URI fits, then give up on it.
    let keep = event.description.length
    while (keep > MIN_DESCRIPTION_CHARS) {
      keep = Math.floor(keep / 2)
      const shortened = `${event.description.slice(0, keep).trimEnd()}…`
      uri = build(formatInviteBody({ ...eventForBody, description: shortened }, options))
      truncated = true
      if (uri.length <= MAILTO_MAX_LENGTH) break
    }

    if (uri.length > MAILTO_MAX_LENGTH) {
      uri = build(formatInviteBody({ ...eventForBody, description: undefined }, options))
      truncated = true
    }
  }

  return { uri, recipients, truncated }
}
