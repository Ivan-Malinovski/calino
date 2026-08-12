import { AIVisionExtractionError, type ExtractedEventFields } from './types'

/**
 * System prompt instructing the model to extract event details from a photo
 * of a flyer/poster/screenshot/invite and respond with strict JSON only.
 */
export function buildExtractionSystemPrompt(): string {
  const now = new Date()
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const nowIso = now.toISOString()

  return `You are an expert at reading event flyers, posters, invitations, to-do lists, and screenshots (from a photo) and extracting structured calendar details.

Current date/time (UTC, ISO-8601): ${nowIso}
User's IANA timezone: ${timeZone}

You will be shown an image. It might be a physical flyer, a poster, a screenshot of a social media post, an invite, a ticket, a handwritten to-do list, or similar. Carefully read all visible text, including small print, dates, times, addresses, and any other identifying details.

Extract the details and respond with STRICT JSON ONLY — no markdown code fences, no explanation, no prose before or after. Respond with a JSON ARRAY of one or more candidate objects, each matching this shape (all fields optional; omit any field you cannot determine with reasonable confidence):

[
  {
    "title": string,
    "location": string,
    "description": string,
    "start": string,
    "end": string,
    "allDay": boolean,
    "confidence": "low" | "medium" | "high",
    "kind": "event" | "task"
  }
]

Return MORE THAN ONE candidate only when the image is genuinely ambiguous in a way that changes the details — for example: several distinct dates/times are printed for what looks like the same event (e.g. "Fri or Sat", a multi-date tour listing where the user likely wants one specific date) and you cannot tell which one applies, or the flyer advertises multiple separate events and it's unclear which one the user is trying to add. In that case, return one candidate per plausible option so the user can pick. A to-do list is the other multi-candidate case: return one candidate per distinct item on the list. Otherwise — the normal case — return a single-item array with your best single interpretation. Do not pad the array with near-duplicates just to hedge; only split when the details genuinely differ.

Rules:
- "kind" tells the app whether to create a calendar event or a to-do. Default to "event". Use "task" only when the item reads as something the user has to *do* rather than somewhere they have to *be* — a to-do list, a checklist, a chore list, a shopping list, a "remember to…" note, an assignment or a deadline. A flyer, poster, invite, ticket, meeting or appointment is an "event".
- For a "task", "start" (if determinable) is the due date and "end" and "location" are usually absent — omit them rather than inventing them.
- "start" and "end" must be ISO-8601 LOCAL datetimes with NO timezone offset and NO trailing "Z", in the form "YYYY-MM-DDTHH:mm" (e.g. "2026-07-25T18:00"). Treat the time as local time in the user's timezone (${timeZone}) — do not convert it.
- Resolve relative or partial dates ("this Saturday", "next Fri", "Aug 3rd", "tomorrow") into absolute dates using the current date given above. Assume the *next* upcoming occurrence of a weekday if no date is given.
- If only a date is visible with no time, omit "start"/"end" times are still required as datetimes — pick a sensible time if one is implied (e.g. "doors 7pm"), otherwise set "allDay": true and use midnight ("T00:00") for start.
- If an end time/date is not stated, omit "end" rather than guessing wildly, unless a duration is clearly implied.
- "location" should be the venue name and/or address as printed, as complete as possible.
- "title" should be a concise, human-readable event name — not the entire flyer text.
- "description" may include extra useful details (organizer, ticket info, notes) but should stay concise.
- Set "confidence" to "high" if the date/time is explicit and unambiguous, "medium" if you had to infer or resolve relative dates, "low" if the image is unclear, partially unreadable, or you are guessing significantly.
- If the image does not appear to contain any event or task information at all, return a single-item array containing {} (empty object) or whatever little you can determine, with "confidence": "low".

Respond with the JSON array and nothing else.`
}

/** Short user-turn instruction accompanying the image. */
export function buildExtractionUserPrompt(): string {
  return 'Extract the event or task details from this image as a JSON array of candidates, per the system instructions.'
}

const VALID_CONFIDENCE = new Set(['low', 'medium', 'high'])
const VALID_KIND = new Set(['event', 'task'])

function coerceExtractedFields(candidate: unknown): ExtractedEventFields {
  if (!candidate || typeof candidate !== 'object') {
    return {}
  }
  const source = candidate as Record<string, unknown>
  const result: ExtractedEventFields = {}

  if (typeof source.title === 'string') result.title = source.title
  if (typeof source.location === 'string') result.location = source.location
  if (typeof source.description === 'string') result.description = source.description
  if (typeof source.start === 'string') result.start = source.start
  if (typeof source.end === 'string') result.end = source.end
  if (typeof source.allDay === 'boolean') result.allDay = source.allDay
  if (typeof source.confidence === 'string' && VALID_CONFIDENCE.has(source.confidence)) {
    result.confidence = source.confidence as ExtractedEventFields['confidence']
  }
  // Anything unrecognised is dropped rather than defaulted here — an absent
  // kind and an "event" kind mean the same thing downstream.
  if (typeof source.kind === 'string' && VALID_KIND.has(source.kind)) {
    result.kind = source.kind as ExtractedEventFields['kind']
  }

  return result
}

function stripMarkdownFences(raw: string): string {
  const trimmed = raw.trim()
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  if (fenced) {
    return fenced[1].trim()
  }
  return trimmed
}

function salvageJsonBlock(raw: string): string | undefined {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) {
    return undefined
  }
  return raw.slice(start, end + 1)
}

function salvageJsonArrayBlock(raw: string): string | undefined {
  const start = raw.indexOf('[')
  const end = raw.lastIndexOf(']')
  if (start === -1 || end === -1 || end <= start) {
    return undefined
  }
  return raw.slice(start, end + 1)
}

const MAX_CANDIDATES = 5

/**
 * Robustly parse the model's raw text reply into one or more candidate
 * ExtractedEventFields. Accepts either a JSON array (the requested shape) or
 * a bare object (tolerated for models that ignore the array instruction).
 * Tries, in order: direct JSON.parse, stripping markdown fences, then
 * salvaging the first array/object block. Throws AIVisionExtractionError if
 * all attempts fail.
 */
export function parseExtractedCandidates(raw: string): ExtractedEventFields[] {
  const attempts: Array<() => unknown> = [
    () => JSON.parse(raw),
    () => JSON.parse(stripMarkdownFences(raw)),
    () => {
      const stripped = stripMarkdownFences(raw)
      const salvaged = salvageJsonArrayBlock(stripped) ?? salvageJsonBlock(stripped)
      if (!salvaged) throw new Error('No JSON found in response')
      return JSON.parse(salvaged)
    },
  ]

  let lastError: unknown
  for (const attempt of attempts) {
    try {
      const parsed = attempt()
      const list = Array.isArray(parsed) ? parsed : [parsed]
      const coerced = list.slice(0, MAX_CANDIDATES).map(coerceExtractedFields)
      return coerced.length > 0 ? coerced : [{}]
    } catch (err) {
      lastError = err
    }
  }

  throw new AIVisionExtractionError('Could not parse a valid response from the model', lastError)
}

// A small 32x32 PNG with visible content (a solid-color square with a
// letter) — deliberately NOT a degenerate 1x1 pixel. Some reasoning models,
// when shown a 1x1 image, reason their way to "this isn't really an image"
// and answer the probe incorrectly even though they're vision-capable.
export const TEST_IMAGE_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgEAIAAACsiDHgAAACgElEQVRYw2M0MSkvf/2aYcgCpoF2wKgHBtoBox4YaAeMemCgHTDqAVoY2iwYcZ731enTHR0iIqf/dfwXYRBL5P/HbDIEPMBuyHqJcau9spYPuwVU6CxDJ4OI6249HrZjQ8ADtl2aVmwCnNPZchk+HVt589VvR4i4a7v+FPZbQ8ADHooGy9mhZs723dv1TeQu54sXf0u1NWResThI6wiZMK8dpB7g+cvBwaRnFa4uxnbgee77e/+qr9g/Yvk9fV/FVcmf3RA1rrv1eNipnJCo5gGHPdpxbImsM5j3M/TuvH8x8uc/iPi+1Zf7f5VD2G4h+nLs7wapB5ATz84HF+AeuMP54sWf0sd5bw3/ialOkNRi3qzwQzSbRW0QeUBwKs9xpt2m3SoPWN3v579q/rsR4mhkNfsqrkjAE1K7/hQ2qmVoKnjA5Z1uM/smpjTG2Qw2O4QvXPj5ClPNvlWXJ8ATUof+VOqVSIyU98jmLMn8KJCvry4/nWUp8boif0yU/NB9x/Z5/J9ESmxnoUSzuC5/O7OnfpR8Bcv2t/O/qP2X2bXm4uOfQrjUa/VJX2eR1P+ioMCy061Dbyr7rTsMz0/9ocQJlHnALcRAjv0twzyGxwwiWyTPeP4onCKzY8fXeFzqdeRkuVlD5zNkM/BDS6RpW3ee+kqRByjKA+6K+vCSZwdS0YkLXOF+3Pt79QurD+n/+qV1hEyY1mr2y1xnlRgAD8hriz5iFlLXlLJhvgMteYhOzbtdL335aQ0NghB9OTaKagYyPeAWoi8Lq5J23r9AMOyRwa6Ki9k/ofWAy249HvajjGcZOxlEyHMJFUqhgQWjHZqBBqMeGGgw6oGBBkPeAwDQbeRxVaIJNwAAAABJRU5ErkJggg=='
export const TEST_IMAGE_MIME = 'image/png'

/** Short, cheap prompt used to verify the selected model can see images. */
export function buildVisionProbePrompt(): string {
  return 'Reply with exactly one word: YES if you can see an image in this message, or NO if you cannot.'
}

/**
 * Forgiving check of the probe reply — models often add punctuation or
 * extra words despite instructions to reply with a single word.
 */
export function parseVisionProbeReply(raw: string): boolean {
  const normalized = raw.trim().toLowerCase()
  const hasYes = /\byes\b/.test(normalized)
  const hasNo = /\bno\b/.test(normalized)
  if (hasYes && !hasNo) return true
  if (hasNo && !hasYes) return false
  // Ambiguous or contains both — fall back to whichever appears first.
  if (hasYes && hasNo) {
    return normalized.indexOf('yes') < normalized.indexOf('no')
  }
  return false
}
