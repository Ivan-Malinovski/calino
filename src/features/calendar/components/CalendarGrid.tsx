import type { JSX } from 'react';
import { useMemo } from 'react';
import {
  format,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isSameMonth,
  isToday,
  parseISO,
} from 'date-fns';
import { useCalendarStore } from '@/store/calendarStore';
import { EventCard } from './EventCard';
import type { CalendarEvent } from '@/types';
import styles from './CalendarGrid.module.css';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function CalendarGrid(): JSX.Element {
  const currentDate = useCalendarStore((state) => state.currentDate);
  const events = useCalendarStore((state) => state.events);
  const calendars = useCalendarStore((state) => state.calendars);
  const getEventsForDateRange = useCalendarStore((state) => state.getEventsForDateRange);
  const openModal = useCalendarStore((state) => state.openModal);

  const date = parseISO(currentDate);

  const days = useMemo(() => {
    const monthStart = startOfMonth(date);
    const monthEnd = endOfMonth(date);
    const calendarStart = startOfWeek(monthStart);
    const calendarEnd = endOfWeek(monthEnd);

    return eachDayOfInterval({ start: calendarStart, end: calendarEnd });
  }, [date]);

  const eventsMap = useMemo(() => {
    const monthStart = startOfMonth(date);
    const monthEnd = endOfMonth(date);
    const events = getEventsForDateRange(
      format(monthStart, 'yyyy-MM-dd'),
      format(monthEnd, 'yyyy-MM-dd')
    );

    const map = new Map<string, CalendarEvent[]>();
    events.forEach((event) => {
      const eventDate = format(parseISO(event.start), 'yyyy-MM-dd');
      const existing = map.get(eventDate) || [];
      map.set(eventDate, [...existing, event]);
    });
    return map;
  }, [date, events, calendars, getEventsForDateRange]);

  const handleDayClick = (day: Date): void => {
    openModal(format(day, 'yyyy-MM-dd'));
  };

  return (
    <div className={styles.grid}>
      <div className={styles.weekdays}>
        {WEEKDAYS.map((day) => (
          <div key={day} className={styles.weekday}>
            {day}
          </div>
        ))}
      </div>
      <div className={styles.days}>
        {days.map((day) => {
          const dateKey = format(day, 'yyyy-MM-dd');
          const dayEvents = eventsMap.get(dateKey) || [];
          const isCurrentMonth = isSameMonth(day, date);
          const isTodayDate = isToday(day);

          return (
            <div
              key={dateKey}
              className={`${styles.day} ${!isCurrentMonth ? styles.otherMonth : ''} ${isTodayDate ? styles.today : ''}`}
              onClick={() => handleDayClick(day)}
            >
              <div className={styles.dayHeader}>
                <span className={styles.dayNumber}>{format(day, 'd')}</span>
              </div>
              <div className={styles.events}>
                {dayEvents.slice(0, 3).map((event) => (
                  <EventCard key={event.id} event={event} />
                ))}
                {dayEvents.length > 3 && (
                  <div className={styles.moreEvents}>+{dayEvents.length - 3} more</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
