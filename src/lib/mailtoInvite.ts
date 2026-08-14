import { format, parseISO } from 'date-fns'
import type { CalendarAttendee, CalendarEvent, CalendarOrganizer } from '@/types'

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
    const start = parseISO(event.start)
    const end = parseISO(event.end)
    if (Number.isNaN(start.getTime())) return ''

    if (event.isAllDay) {
      const startDay = format(start, 'EEEE, d MMMM yyyy')
      if (Number.isNaN(end.getTime())) return startDay
      const endDay = format(end, 'EEEE, d MMMM yyyy')
      return startDay === endDay ? `${startDay} (all day)` : `${startDay} – ${endDay} (all day)`
    }

    const timePattern = use24Hour ? 'HH:mm' : 'h:mm a'
    const startText = format(start, `EEEE, d MMMM yyyy 'at' ${timePattern}`)
    if (Number.isNaN(end.getTime())) return startText

    // Same-day events only need the clock time on the far side.
    return format(start, 'yyyy-MM-dd') === format(end, 'yyyy-MM-dd')
      ? `${startText} – ${format(end, timePattern)}`
      : `${startText} – ${format(end, `EEEE, d MMMM yyyy 'at' ${timePattern}`)}`
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
export function formatInviteBody(
  event: CalendarEvent,
  options: InviteOptions = {}
): string {
  const { use24Hour = true } = options
  const lines: string[] = []

  lines.push(`You're invited to: ${event.title || 'Untitled event'}`)
  lines.push('')

  const when = formatWhen(event, use24Hour)
  if (when) lines.push(`When: ${when}`)
  if (event.location) lines.push(`Where: ${event.location}`)
  if (event.url) lines.push(`Link: ${event.url}`)
  if (event.organizer?.email) {
    lines.push(
      `Organizer: ${event.organizer.name ? `${event.organizer.name} <${event.organizer.email}>` : event.organizer.email}`
    )
  }

  const others = (event.attendees ?? []).map((a) => a.name || a.email)
  if (others.length > 0) lines.push(`Attendees: ${others.join(', ')}`)

  if (event.description) {
    lines.push('')
    lines.push(event.description)
  }

  lines.push('')
  lines.push('Please reply to let me know if this works for you.')

  return lines.join('\n')
}

export interface MailtoResult {
  uri: string
  /** Recipients actually addressed, after self-exclusion and deduplication. */
  recipients: string[]
  /** True when the description had to be cut to stay under the length cap. */
  truncated: boolean
  /** Subject line, unencoded — for the clipboard fallback. */
  subject: string
  /** Full body, never truncated: the clipboard has no length ceiling. */
  body: string
}

/** Plain-text rendering for users whose `mailto:` handler is broken or absent. */
export function formatInviteForClipboard(mailto: MailtoResult): string {
  return `To: ${mailto.recipients.join(', ')}\nSubject: ${mailto.subject}\n\n${mailto.body}`
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
  const subject = when
    ? `Invitation: ${event.title || 'Untitled event'} — ${when}`
    : `Invitation: ${event.title || 'Untitled event'}`

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

  return { uri, recipients, truncated, subject, body: fullBody }
}
