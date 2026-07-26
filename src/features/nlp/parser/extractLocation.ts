export function extractLocation(input: string): string | undefined {
  const dateTimeWords = [
    'today',
    'tomorrow',
    'yesterday',
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'saturday',
    'sunday',
    'mon',
    'tue',
    'wed',
    'thu',
    'fri',
    'sat',
    'sun',
    'next week',
    'last week',
    'next month',
    'last month',
    'next year',
    'last year',
  ]

  // Recurrence and other stop words that should delimit a location capture,
  // even though they are not strictly date/time markers. The location pattern
  // is greedy up to the next date/time word, so without these the
  // recurrence phrase leaks into the location.
  const stopWords = ['every', 'each', 'recurring', 'recurs']

  const timeWords = ['morning', 'afternoon', 'evening', 'night', 'noon', 'midnight']

  const isTimeLike = (text: string): boolean => {
    const timePatterns = [
      /^\d{1,2}(?::\d{2})?\s*(?:am|pm)?$/i,
      /^\d{1,2}\s*-\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)?$/i,
      /^\d{1,2}(?::\d{2})?\s*(?:am|pm)?\s+to\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?$/i,
      /^\d{1,2}(?::\d{2})?\s*(?:am|pm)\s*-\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)?$/i,
      /^(?:morning|afternoon|evening|night|noon|midnight)$/i,
      /^\d{1,2}\s+(?:minute|minutes|hour|hours)$/i,
    ]
    const trimmed = text.trim().toLowerCase()
    return timePatterns.some((p) => p.test(trimmed))
  }

  const findDateTimePosition = (text: string): number => {
    const lower = text.toLowerCase()
    let earliest = text.length

    for (const word of dateTimeWords) {
      const pos = lower.indexOf(word)
      if (pos !== -1 && pos < earliest) {
        earliest = pos
      }
    }

    for (const word of timeWords) {
      const re = new RegExp(`\\b${word}\\b`)
      const match = lower.match(re)
      if (match && match.index !== undefined && match.index < earliest) {
        earliest = match.index
      }
    }

    for (const word of stopWords) {
      // Use a word-boundary match so "th" inside "the" doesn't trigger.
      const re = new RegExp(`\\b${word}\\b`)
      const match = lower.match(re)
      if (match && match.index !== undefined && match.index < earliest) {
        earliest = match.index
      }
    }

    // Also detect standalone time patterns like "9am", "10:30", "5pm"
    const timePatternRe = /\b\d{1,2}(?::\d{2})?\s*(?:am|pm)?\b/gi
    let tm: RegExpExecArray | null
    while ((tm = timePatternRe.exec(lower)) !== null) {
      // Only count as time if it looks like a clock time (with colon or am/pm)
      if (tm.index < earliest && (/[:]/.test(tm[0]) || /(?:am|pm)/i.test(tm[0]))) {
        earliest = tm.index
      }
    }

    // Detect "N to N" and "N-N" time ranges — find the earliest digit
    const rangeRe =
      /\b(\d{1,2})(?::(\d{2}))?\s*(?:am|pm)?\s*(?:to|-)\s*(\d{1,2})(?::(\d{2}))?\s*(?:am|pm)?\b/gi
    let rm: RegExpExecArray | null
    while ((rm = rangeRe.exec(lower)) !== null) {
      if (rm.index < earliest) {
        earliest = rm.index
      }
    }

    return earliest
  }

  const extractAfterPreposition = (input: string, preposition: string): string | undefined => {
    const regex = new RegExp(`\\s+${preposition}\\s+(.+)$`, 'i')
    const match = input.match(regex)
    if (match && match[1]) {
      let afterPrep = match[1]
      // Strip leading 'the' after 'at' so "at the office" yields "office", not "the office"
      if (preposition === 'at') {
        afterPrep = afterPrep.replace(/^the\s+/i, '')
      }
      const dateTimePos = findDateTimePosition(afterPrep)
      let location = afterPrep.substring(0, dateTimePos).trim()
      location = location.replace(/^,+|,+$/g, '').trim()
      if (location.length >= 2 && !isTimeLike(location)) {
        return location
      }
    }
    return undefined
  }

  const lookbehindWords =
    '(?:tomorrow|yesterday|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun|at|on|for|every|each|recurring|recurs)'

  const patterns = [
    new RegExp(
      `\\bin\\s+([a-zA-ZæøåÆØÅ]+(?:\\s+[a-zA-ZæøåÆØÅ]+)*?)\\b(?=\\s*${lookbehindWords}\\b)`,
      'i'
    ),
    new RegExp(
      `\\bat\\s+([a-zA-ZæøåÆØÅ]+(?:\\s+[a-zA-ZæøåÆØÅ]+)*?)\\b(?=\\s*${lookbehindWords}\\b)`,
      'i'
    ),
    new RegExp(
      `\\b@\\s*([a-zA-ZæøåÆØÅ]+(?:\\s+[a-zA-ZæøåÆØÅ]+)*?)\\b(?=\\s*${lookbehindWords}\\b)`,
      'i'
    ),
  ]

  for (const pattern of patterns) {
    const match = input.match(pattern)
    if (match && match[1]) {
      let location = match[1].trim()
      // Strip leading 'the' when extracted via 'at' preposition pattern
      location = location.replace(/^the\s+/i, '')
      location = location.replace(/^,+|,+$/g, '').trim()
      if (location.length >= 2 && !isTimeLike(location)) {
        return location
      }
    }
  }

  const loc = extractAfterPreposition(input, 'in')
  if (loc) return loc

  const loc2 = extractAfterPreposition(input, 'at')
  if (loc2) return loc2

  const loc3 = extractAfterPreposition(input, '@')
  if (loc3) return loc3

  const simpleAtMatch = input.match(/\bat\s+([a-zA-Z][a-zA-Z\s,]+)$/i)
  if (simpleAtMatch && simpleAtMatch[1]) {
    let location = simpleAtMatch[1].trim()
    // Strip leading 'the' after 'at'
    location = location.replace(/^the\s+/i, '')
    const dateTimePos = findDateTimePosition(location)
    if (dateTimePos < location.length) {
      location = location.substring(0, dateTimePos)
    }
    location = location.replace(/^,+|,+$/g, '').trim()
    if (location.length >= 2 && !isTimeLike(location)) {
      return location
    }
  }

  return undefined
}
