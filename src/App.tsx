import type { JSX } from 'react';
import { useState, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useCalendarStore } from './store/calendarStore';
import {
  CalendarHeader,
  CalendarGrid,
  WeekView,
  DayView,
  AgendaView,
  EventModal,
} from './features/calendar';
import { QuickAdd, type NLPParseResult } from './features/nlp';
import type { CalendarEvent } from './types';
import './App.css';

function App(): JSX.Element {
  const currentView = useCalendarStore((state) => state.currentView);
  const addEvent = useCalendarStore((state) => state.addEvent);
  const calendars = useCalendarStore((state) => state.calendars);
  const [isQuickAddOpen, setIsQuickAddOpen] = useState(false);

  const renderView = (): JSX.Element => {
    switch (currentView) {
      case 'month':
        return <CalendarGrid />;
      case 'week':
        return <WeekView />;
      case 'day':
        return <DayView />;
      case 'agenda':
        return <AgendaView />;
      default:
        return <CalendarGrid />;
    }
  };

  const handleQuickAdd = useCallback((result: NLPParseResult): void => {
    const defaultCalendar = calendars.find((c) => c.isDefault) || calendars[0];
    
    const event: CalendarEvent = {
      id: uuidv4(),
      calendarId: defaultCalendar?.id || 'default',
      title: result.title,
      location: result.location,
      start: result.startDate.toISOString(),
      end: result.endDate ? result.endDate.toISOString() : result.startDate.toISOString(),
      isAllDay: result.isAllDay,
      recurrence: result.recurrence,
    };

    addEvent(event);
    setIsQuickAddOpen(false);
  }, [addEvent, calendars]);

  const handleToggleQuickAdd = useCallback(() => {
    setIsQuickAddOpen((prev) => !prev);
  }, []);

  return (
    <div className="app">
      <CalendarHeader onQuickAdd={handleToggleQuickAdd} />
      <main className="main">
        {isQuickAddOpen && (
          <QuickAdd onAdd={handleQuickAdd} onCancel={() => setIsQuickAddOpen(false)} />
        )}
        {renderView()}
      </main>
      <EventModal />
    </div>
  );
}

export default App;
