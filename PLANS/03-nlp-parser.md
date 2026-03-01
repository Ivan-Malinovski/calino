# Plan 03: Natural Language Event Creation

## Objective
Implement natural language parsing for creating events from text input.

## Requirements (from project_requirements.txt)

### Parser Requirements
- Parse natural language input into structured event data
- Extract: event title, date, time, duration, location
- Handle relative dates: "tomorrow", "next Thursday", "in 3 days"
- Handle times: "2 PM", "14:00", "noon", "evening"
- Handle implicit duration: "hang out with girlfriend at 2 PM" → default 1 hour
- Handle explicit duration: "meeting for 2 hours starting at 3 PM"

### Implementation Approach
No AI required. Use rule-based parsing with libraries:
- **JavaScript/TypeScript**: `chrono-node` for date parsing
- Custom regex patterns for event title extraction

### Example Inputs and Expected Outputs

| Input | Title | Date | Time | Duration |
|-------|-------|------|------|----------|
| "hang out with girlfriend at 2 PM on Thursday" | hang out with girlfriend | Next Thursday | 14:00 | 1 hour (default) |
| "dentist appointment tomorrow at 10am" | dentist appointment | Tomorrow | 10:00 | 1 hour (default) |
| "team standup every weekday at 9am" | team standup | Weekdays | 09:00 | Recurring |
| "lunch with mom on March 15th at noon for 2 hours" | lunch with mom | March 15 | 12:00 | 2 hours |

## Technical Approach

### Library: chrono-node
Chrono is excellent for natural language date parsing:
- Supports English, Spanish, French, German, etc.
- Handles relative dates ("tomorrow", "next week")
- Handles times ("2pm", "14:00", "noon")
- Extracts parsed components

### Parser Architecture
```
src/features/nlp/
├── parser/
│   ├── NLParser.ts           # Main parser class
│   ├── extractTitle.ts      # Extract event title
│   ├── extractDuration.ts   # Parse duration
│   └── extractLocation.ts   # Extract location
├── types/
│   └── index.ts
└── index.ts
```

### Parsing Algorithm
1. Use chrono-node to parse date/time from input
2. Remove date/time portions from text to extract title
3. Use regex to find location keywords
4. Default duration: 1 hour if not specified

### NLP Parse Result Type
```typescript
interface NLPParseResult {
  title: string;
  startDate: Date;
  endDate?: Date;
  isAllDay: boolean;
  duration?: number; // minutes
  location?: string;
  confidence: number; // 0-1, how well we parsed
  raw: string; // original input
}
```

## Implementation Steps

### Step 3.1: Install chrono-node
```bash
pnpm add chrono-node
```

### Step 3.2: Create NLP Parser Service
- Wrap chrono-node with custom interface
- Handle edge cases (no date found, ambiguous parsing)

### Step 3.3: Extract Event Title
- Remove date/time patterns from input
- Clean up remaining text
- Handle edge cases like "meeting with John at 2pm"

### Step 3.4: Extract Duration
- Look for duration patterns: "for 2 hours", "30 minutes"
- Apply default duration if not specified (1 hour)

### Step 3.5: Extract Location
- Look for location keywords: "at", "in", "location:"
- Extract text after keyword

### Step 3.6: Build Quick Add UI
- Text input for natural language
- Real-time preview of parsed event
- Confirm/cancel flow

### Step 3.7: Handle Recurring Events
- Detect patterns: "every Monday", "weekly", "daily"
- Return recurrence rule in parse result

## Edge Cases to Handle
- No date in input → Use today's date
- No time in input → Use all-day or prompt for time
- Ambiguous date → Use context (current day of week)
- Very long input → Truncate title sensibly

## Testing Strategy
- Test suite with 20+ example inputs
- Test each extraction function independently
- Test edge cases (empty input, invalid dates)

## Success Criteria
- [ ] "meeting tomorrow at 2pm" → parsed correctly
- [ ] "dentist appointment on March 15 at 10am for 30 minutes" → parsed correctly
- [ ] Title extraction works without date/time in text
- [ ] Duration extraction works
- [ ] Location extraction works
- [ ] Quick add UI integrates with event modal
- [ ] All tests passing (target: 95%+ on parser)
