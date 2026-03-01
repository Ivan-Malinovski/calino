# Plan 02: Core Calendar Features

## Objective
Build the core calendar UI with event management (CRUD) and multiple views.

## Requirements (from project_requirements.txt)

### Event Management
- Create, read, update, delete (CRUD) events
- Events with: title, description, location, start/end datetime
- All-day events support
- Recurring events (daily, weekly, monthly, yearly, custom patterns)
- Event colors/categories
- Event reminders/notifications

### Views
- Month view (default)
- Week view
- Day view
- Agenda/List view
- Navigate to specific dates

### Calendar Management
- Multiple calendars support
- Calendar colors
- Show/hide calendars
- Default calendar selection

### Modern UX Features (Plan for Future)
- Drag-and-drop event rescheduling in week/day views
- Keyboard shortcuts (arrow keys to navigate, Enter to edit, etc.)
- Toast notifications for user feedback
- Optimistic UI updates

## Technical Approach

### State Management
- React Context or Zustand for global calendar state
- Local component state for UI interactions

### Event Data Model
```typescript
interface CalendarEvent {
  id: string;
  calendarId: string;
  title: string;
  description?: string;
  location?: string;
  start: Date;
  end: Date;
  isAllDay: boolean;
  color?: string;
  recurrence?: RecurrenceRule;
  reminders?: Reminder[];
}

interface Calendar {
  id: string;
  name: string;
  color: string;
  isVisible: boolean;
  isDefault: boolean;
}

interface RecurrenceRule {
  frequency: 'daily' | 'weekly' | 'monthly' | 'yearly';
  interval: number;
  endDate?: Date;
  count?: number;
}
```

### Component Structure
```
src/features/calendar/
├── components/
│   ├── CalendarGrid.tsx      # Month/week/day grid
│   ├── CalendarHeader.tsx    # Navigation, view switcher
│   ├── EventCard.tsx         # Single event display
│   ├── EventModal.tsx        # Create/edit event form
│   └── ViewSwitcher.tsx     # View type selector
├── hooks/
│   ├── useCalendar.ts        # Calendar state management
│   ├── useEvents.ts          # Event CRUD operations
│   └── useViews.ts           # View navigation
├── types/
│   └── index.ts
└── index.ts
```

### Key Implementation Details

#### Calendar Grid
- Use CSS Grid for month view
- 7 columns (days), 5-6 rows (weeks)
- Current day highlighting
- Event overflow handling (show +N more)

#### Event Modal
- Form fields: title, description, location, start, end, all-day toggle
- Recurrence builder UI
- Color picker for events

#### View Navigation
- Previous/next buttons for date navigation
- Today button to jump to current date
- Date picker for jumping to specific date

## Implementation Steps

### Step 2.1: Set Up Calendar Context
- Create CalendarProvider with events and calendars state
- Implement addEvent, updateEvent, deleteEvent, getEventsForDateRange

### Step 2.2: Build Calendar Grid (Month View)
- Render days of month with correct starting day
- Display events on each day
- Handle click on day to create event

### Step 2.3: Build Event Modal
- Form with validation
- Date/time pickers
- All-day toggle
- Save/cancel actions

### Step 2.4: Implement Week/Day/Agenda Views
- Week: 7 columns, time rows
- Day: Single column, hour rows
- Agenda: List of events, grouped by date

### Step 2.5: Add Navigation
- Month/week/day navigation
- Today button
- View switcher

### Step 2.6: Calendar Management
- Create/delete calendars
- Toggle visibility
- Set default calendar

### Step 2.7: Recurring Events
- Use rrule library for recurrence logic
- Expand recurring events for display
- Store recurrence rule, not expanded instances

### Step 2.8: Drag and Drop (Week/Day View)
- Use @dnd-kit/core or react-beautiful-dnd for drag-drop
- Allow dragging events to new time slots
- Update event time on drop
- Show visual feedback during drag
- Support resizing events (drag bottom edge)

## Testing Strategy
- Unit tests for date range calculations
- Component tests for CalendarGrid
- Integration tests for event CRUD
- Test recurring event expansion

## Dependencies to Add
- [ ] rrule (recurring events)

## Success Criteria
- [ ] Month view displays correctly with events
- [ ] Can create event via modal
- [ ] Can edit existing event
- [ ] Can delete event
- [ ] Week/day/agenda views work
- [ ] Navigation works (prev/next/today)
- [ ] Multiple calendars with visibility toggle
- [ ] Drag-and-drop works in week/day views
- [ ] All tests passing
