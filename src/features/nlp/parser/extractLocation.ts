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

  const timeWords = ['morning', 'afternoon', 'evening', 'night', 'noon', 'midnight']

  const isTimeLike = (text: string): boolean => {
    const timePatterns = [
      /^\d{1,2}(?::\d{2})?\s*(?:am|pm)?$/i,
      /^\d{1,2}\s*-\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)?$/i,
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
      const pos = lower.indexOf(word)
      if (pos !== -1 && pos < earliest) {
        earliest = pos
      }
    }

    return earliest
  }

  const extractAfterPreposition = (input: string, preposition: string): string | undefined => {
    const regex = new RegExp(`\\\\s+${preposition}\\\\s+(.+)$`, 'i')
    const match = input.match(regex)
    if (match && match[1]) {
      const afterPrep = match[1]
      const dateTimePos = findDateTimePosition(afterPrep)
      let location = afterPrep.substring(0, dateTimePos).trim()
      location = location.replace(/^,+|,+$/g, '').trim()
      if (location.length >= 2 && !isTimeLike(location)) {
        return location
      }
    }
    return undefined
  }

  const patterns = [
    /\bin\s+([a-zA-ZæøåÆØÅ]+(?:\s+[a-zA-ZæøåÆØÅ]+)*?)\b(?=\s*(?:tomorrow|yesterday|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday|at|on|for)\b)/i,
    /\bat\s+([a-zA-ZæøåÆØÅ]+(?:\s+[a-zA-ZæøåÆØÅ]+)*?)\b(?=\s*(?:tomorrow|yesterday|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday|at|on|for)\b)/i,
    /\b@\s*([a-zA-ZæøåÆØÅ]+(?:\s+[a-zA-ZæøåÆØÅ]+)*?)\b(?=\s*(?:tomorrow|yesterday|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday|at|on|for)\b)/i,
  ]

  for (const pattern of patterns) {
    const match = input.match(pattern)
    if (match && match[1]) {
      let location = match[1].trim()
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

  const atTheMatch = input.match(/\bat\s+the\s+([a-zA-Z][a-zA-Z\s,]+)/i)
  if (atTheMatch && atTheMatch[1]) {
    let location = atTheMatch[1].trim()
    location = location.replace(/^,+|,+$/g, '').trim()
    if (location.length >= 2 && !isTimeLike(location)) {
      return location
    }
  }

  const simpleAtMatch = input.match(/\bat\s+([a-zA-Z][a-zA-Z\s,]+)$/i)
  if (simpleAtMatch && simpleAtMatch[1]) {
    let location = simpleAtMatch[1].trim()
    location = location.replace(/^,+|,+$/g, '').trim()
    if (location.length >= 2 && !isTimeLike(location)) {
      return location
    }
  }

  return undefined
}
