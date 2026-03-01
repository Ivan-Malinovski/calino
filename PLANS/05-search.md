# Plan 05: Search Feature

## Objective
Implement full-text search for events across all calendars.

## Requirements

### Search Capabilities
- Full-text search on event titles
- Search in event descriptions
- Search in event locations
- Filter by date range
- Filter by calendar

### Technical Approach

### Client-Side Search (Initial Implementation)
- Use Fuse.js for fuzzy matching
- Index event fields: title, description, location
- Debounce search input (300ms)
- Show results in real-time

### Server-Side Search (Future)
- CalDAV REPORT with text filter
- For servers that support it

### Component Structure
```
src/features/search/
├── components/
│   ├── SearchBar.tsx         # Search input with icon
│   ├── SearchResults.tsx    # Results dropdown/list
│   └── SearchFilters.tsx   # Date/calendar filters
├── hooks/
│   └── useSearch.ts         # Search logic
├── lib/
│   └── searchIndex.ts       # Fuse.js configuration
├── types/
│   └── index.ts
└── index.ts
```

### Search Data Model
```typescript
interface SearchResult {
  event: CalendarEvent;
  matches: {
    field: 'title' | 'description' | 'location';
    indices: [number, number][];
  }[];
  score: number;
}

interface SearchFilters {
  dateFrom?: Date;
  dateTo?: Date;
  calendarIds?: string[];
}
```

## Implementation Steps

### Step 5.1: Install Dependencies
```bash
pnpm add fuse.js
```

### Step 5.2: Create Search Index
- Initialize Fuse.js with event collection
- Configure search keys and weights (title: 2, location: 1.5, description: 1)
- Set threshold for fuzzy matching

### Step 5.3: Build Search UI
- Search bar component with icon
- Keyboard shortcut: Cmd/Ctrl+K to focus
- Escape to close
- Clear button

### Step 5.4: Display Results
- Dropdown with highlighted matches
- Show event preview (title, date, calendar)
- Click to open event
- "No results" state

### Step 5.5: Add Filters
- Date range filter
- Calendar multi-select filter
- Combine with search query

### Step 5.6: Optimize Performance
- Debounce input
- Virtualize long result lists
- Cache search index on change

## Testing Strategy
- Test search accuracy with sample events
- Test fuzzy matching tolerance
- Test filter combinations
- Performance test with 1000+ events

## Success Criteria
- [ ] Search returns relevant results
- [ ] Fuzzy matching works ("meting" finds "meeting")
- [ ] Results show highlighted matches
- [ ] Date filter works
- [ ] Calendar filter works
- [ ] Keyboard shortcut (Cmd+K) works
- [ ] All tests passing
