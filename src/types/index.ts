export type RecurrenceFrequency = 'daily' | 'weekly' | 'monthly' | 'yearly';

export interface RecurrenceRule {
  frequency: RecurrenceFrequency;
  interval: number;
  endDate?: string;
  count?: number;
  byWeekday?: number[];
  byMonthDay?: number[];
  byMonth?: number[];
}

export interface Reminder {
  id: string;
  minutesBefore: number;
  method: 'popup' | 'email';
}

export interface CalendarEvent {
  id: string;
  calendarId: string;
  title: string;
  description?: string;
  location?: string;
  start: string;
  end: string;
  isAllDay: boolean;
  color?: string;
  recurrence?: RecurrenceRule;
  reminders?: Reminder[];
  rruleString?: string;
}

export interface Calendar {
  id: string;
  name: string;
  color: string;
  isVisible: boolean;
  isDefault: boolean;
}

export type ViewType = 'month' | 'week' | 'day' | 'agenda';

export interface CalendarState {
  events: CalendarEvent[];
  calendars: Calendar[];
  currentDate: string;
  currentView: ViewType;
  selectedEventId: string | null;
  isModalOpen: boolean;
  selectedDate: string | null;
}

export interface CalendarActions {
  addEvent: (event: CalendarEvent) => void;
  updateEvent: (id: string, updates: Partial<CalendarEvent>) => void;
  deleteEvent: (id: string) => void;
  addCalendar: (calendar: Calendar) => void;
  updateCalendar: (id: string, updates: Partial<Calendar>) => void;
  deleteCalendar: (id: string) => void;
  toggleCalendarVisibility: (id: string) => void;
  setDefaultCalendar: (id: string) => void;
  setCurrentDate: (date: string) => void;
  setCurrentView: (view: ViewType) => void;
  setSelectedEventId: (id: string | null) => void;
  openModal: (date?: string) => void;
  closeModal: () => void;
  getEventsForDateRange: (start: string, end: string) => CalendarEvent[];
  getVisibleEvents: () => CalendarEvent[];
}

export type CalendarStore = CalendarState & CalendarActions;
