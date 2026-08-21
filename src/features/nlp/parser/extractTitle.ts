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
  // Casual time-of-day references used as event anchors. chrono-node usually
  // consumes these as parsedText, but when it captures only part of the
  // phrase (e.g. "dinner tonight") we still need to strip the token so it
  // doesn't leak into the title.
  /\btonight\b/i,
  /\bthis\s+(?:morning|afternoon|evening|night)\b/i,
  /\btoday\s+(?:morning|afternoon|evening|night)\b/i,
  /\b\d+\s*(?:minute|minutes|hour|hours|day|days|week|weeks)\b/i,
  /\b(?:for|duration|lasting)\s+\d+\s*(?:minute|minutes|hour|hours|day|days)\b/i,
]

export function extractTitle(input: string, parsedText: string): string {
  let text = input

  if (parsedText) {
    if (text.includes(parsedText)) {
      text = text.replace(parsedText, '').trim()
    } else {
      // parsedText may differ from input when preprocessing transformed
      // ordinals or other tokens. Fall back to pattern-based cleanup.
      for (const pattern of DATE_TIME_PATTERNS) {
        text = text.replace(pattern, '').trim()
      }
    }
  }

  text = text
    .replace(/\s+/g, ' ')
    .replace(/^[,\-\s]+|[,\-\s]+$/g, '')
    .trim()

  // Remove duration phrases ("for 2 hours", "lasting 30 minutes") even when
  // chrono's parsedText didn't cover them.
  text = text
    .replace(/\b(?:for|duration|lasting)\s+\d+\s*(?:minute|minutes|hour|hours|day|days)\b/gi, '')
    .trim()

  // Recurrence phrases belong to the rule, not the title: "gym every other
  // day" is a Gym event repeating every other day, and leaving the phrase in
  // made every occurrence read "Gym every other day". Kept in sync with
  // RECURRENCE_PATTERNS in extractDuration.ts — anything parsed into a rule
  // there has to come out of the title here, and nothing else may be stripped.
  // Removing a phrase the parser does NOT understand ("every 2 weeks",
  // "biweekly", "every morning") is strictly worse than leaving it in: the
  // event silently loses the repeat AND the evidence that one was asked for.
  text = text
    .replace(
      /\bevery\s+(?:other\s+)?(?:day|week|month|year|weekday|weekend|monday|tuesday|wednesday|thursday|friday|saturday|sunday)s?\b/gi,
      ''
    )
    .replace(/\b(?:daily|weekly|monthly|yearly|annually)\b/gi, '')
    // chrono may already have eaten the unit ("review every other monday"
    // parses the weekday away), leaving the quantifier stranded. It strands at
    // whichever end the phrase sat: "every monday gym" leaves it leading.
    .replace(/\bevery\s+(?:other\s*)?$/i, '')
    .replace(/^every\s+(?:other\s+)?/i, '')
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
    /\bby\b\s*$/i,
    /\bthe\b\s*$/i,
    /\bon\s+the\b\s*$/i,
    /\bevery\b\s*$/i,
    /\bthis\b\s*$/i,
    /\bnext\b\s*$/i,
    /\blast\b\s*$/i,
    /\bending\b\s*$/i,
    /\bscheduled\b\s*$/i,
  ]

  for (const pattern of prepositionsToRemove) {
    text = text.replace(pattern, '').trim()
  }

  // Drop verb-led time introducers ("meeting starting at 3pm" → "Meeting",
  // "gym beginning at 5" → "Gym") and a dangling trailing "from" left behind
  // when chrono only captured the time that followed it.
  text = text
    .replace(/\b(?:starting|beginning)\b\s*(?:at|from)?\s*/gi, '')
    .replace(/\bfrom\b\s*$/i, '')
    .replace(/\s+/g, ' ')
    .replace(/^[,\-\s]+|[,\-\s]+$/g, '')
    .trim()

  if (!text || text.length < 2) {
    return 'New Event'
  }

  return text.charAt(0).toUpperCase() + text.slice(1)
}

export function getDateTimePatterns(): RegExp[] {
  return DATE_TIME_PATTERNS
}
