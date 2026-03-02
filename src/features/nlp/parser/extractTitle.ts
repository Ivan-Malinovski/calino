const DATE_TIME_PATTERNS = [
  /\b(?:january|february|march|april|may|june|july|august|september|october|november|december)\b/i,
  /\b(?:jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\b/i,
  /\b(?:today|tomorrow|yesterday)\b/i,
  /\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
  /\b(?:mon|tue|tues|wed|thu|thurs|fri|sat|sun)\b/i,
  /\bnext\s+(?:week|month|year|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
  /\b(?:this|last)\s+(?:week|month|year|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
  /\b\d{1,2}(?:st|nd|rd|th)?\s+(?:of\s+)?(?:january|february|march|april|may|june|july|august|september|october|november|december)/i,
  /\b(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}(?:st|nd|rd|th)?/i,
  /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/,
  /\b\d{4}-\d{2}-\d{2}\b/,
  /\b(?:at\s+)?\d{1,2}:\d{2}(?:\s*(?:am|pm))?\b/i,
  /\b(?:at\s+)?\d{1,2}\s*(?:am|pm)\b/i,
  /\b(?:at\s+)?noon\b/i,
  /\b(?:at\s+)?midnight\b/i,
  /\b(?:at\s+)?morning\b/i,
  /\b(?:at\s+)?evening\b/i,
  /\b(?:at\s+)?afternoon\b/i,
  /\b(?:at\s+)?night\b/i,
  /\b\d+\s*(?:minute|minutes|hour|hours|day|days|week|weeks)\b/i,
  /\b(?:for|duration|lasting)\s+\d+\s*(?:minute|minutes|hour|hours|day|days)\b/i,
]

export function extractTitle(input: string, parsedText: string): string {
  let text = input

  if (parsedText) {
    text = text.replace(parsedText, '').trim()
  }

  const locationPatterns = [
    /\bat\s+[a-zA-Z][^onfor]*(?:\s+(?:on|for)\b|$)/i,
    /\b@\s*[a-zA-Z][a-zA-Z\s]*(?:\s+(?:on|for)\b|$)/i,
    /\bin\s+[a-zA-Z][^onfor]*(?:\s+(?:on|for)\b|$)/i,
    /\blocation\s*:\s*[a-zA-Z].+$/i,
  ]

  for (const pattern of locationPatterns) {
    text = text.replace(pattern, '').trim()
  }

  text = text
    .replace(/\s+/g, ' ')
    .replace(/^[,\-\s]+|[,\-\s]+$/g, '')
    .trim()

  const prepositionsToRemove = [
    /\bwith\b\s*$/i,
    /\bfor\b\s*$/i,
    /\bto\b\s*$/i,
    /\bat\b\s*$/i,
    /\bin\b\s*$/i,
    /\bon\b\s*$/i,
  ]

  for (const pattern of prepositionsToRemove) {
    text = text.replace(pattern, '').trim()
  }

  if (!text || text.length < 2) {
    return 'New Event'
  }

  return text.charAt(0).toUpperCase() + text.slice(1)
}

export function getDateTimePatterns(): RegExp[] {
  return DATE_TIME_PATTERNS
}
