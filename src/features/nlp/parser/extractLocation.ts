export function extractLocation(input: string): string | undefined {
  const patterns = [
    /\bat\s+([a-zA-Z][^onfor\d,]+?)(?:\s+(?:on|for)\b|,|\bat\b|$)/i,
    /\b@\s*([a-zA-Z][a-zA-Z\s,]+?)(?:\s+(?:on|for)\b|,|\bat\b|$)/i,
    /\bin\s+([a-zA-Z][^onfor\d,]+?)(?:\s+(?:on|for)\b|,|\bat\b|$)/i,
    /\blocation\s*:\s*([a-zA-Z].+)$/i,
  ]

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

  for (const pattern of patterns) {
    const match = input.match(pattern)
    if (match && match[1]) {
      let location = match[1].trim()
      location = location.replace(/\s+/g, ' ').replace(/^[,\-\s]+|[,\-\s]+$/g, '')
      if (location.length >= 2 && !isTimeLike(location)) {
        return location
      }
    }
  }

  const atTheMatch = input.match(
    /\bat\s+the\s+([a-zA-Z][a-zA-Z\s,]+?)(?:\s+(?:on|for)\b|,|\bat\b|$)/i
  )
  if (atTheMatch && atTheMatch[1]) {
    const location = atTheMatch[1]
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/^[,\-\s]+|[,\-\s]+$/g, '')
    if (location.length >= 2 && !isTimeLike(location)) {
      return location
    }
  }

  const simpleAtMatch = input.match(/\bat\s+([a-zA-Z][a-zA-Z\s,]+)$/i)
  if (simpleAtMatch && simpleAtMatch[1]) {
    const location = simpleAtMatch[1].trim().replace(/^[,\-\s]+|[,\-\s]+$/g, '')
    if (location.length >= 2 && !isTimeLike(location)) {
      return location
    }
  }

  return undefined
}
