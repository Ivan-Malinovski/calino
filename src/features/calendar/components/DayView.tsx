import type { JSX } from 'react';
import { useMemo } from 'react';
import {
  format,
  eachHourOfInterval,
  startOfDay,
  endOfDay,
  parseISO,
  isToday,
} from 'date-fns';
import { useCalendarStore } from '@/store/calendarStore';
import { EventCard } from './EventCard';
import type { CalendarEvent } from '@/types';
import styles from './DayView.module.css';

const HOURS = eachHourOfInterval({
  start: startOfDay(new Date()),
  end: endOfDay(new Date()),
});

export function DayView(): JSX.Element {
  const currentDate = useCalendarStore((state) => state.currentDate);
  const events = useCalendarStore((state) => state.events);
  const calendars = useCalendarStore((state) => state.calendars);
  const getEventsForDateRange = useCalendarStore((state) => state.getEventsForDateRange);
  const openModal = useCalendarStore((state) => state.openModal);

  const date = parseISO(currentDate);

  const dayEvents = useMemo(() => {
    return getEventsForDateRange(
      format(date, 'yyyy-MM-dd'),
      format(date, 'yyyy-MM-dd')
    );
  }, [date, events, calendars, getEventsForDateRange]);

  const handleCellClick = (hour: Date): void => {
    const hourStr = format(hour, 'HH:mm');
    openModal(`${format(date, 'yyyy-MM-dd')}T${hourStr}`);
  };

  const getEventsForHour = (hour: Date): CalendarEvent[] => {
    const hourStart = hour.getHours();
    return dayEvents.filter((event) => {
      const eventHour = parseISO(event.start).getHours();
      return eventHour === hourStart;
    });
  };

  const isCurrentDay = isToday(date);

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.dayInfo}>
          <div className={styles.dayName}>{format(date, 'EEEE')}</div>
          <div className={`${styles.dayNumber} ${isCurrentDay ? styles.today : ''}`}>
            {format(date, 'd')}
          </div>
        </div>
      </div>
      <div className={styles.body}>
        {HOURS.map((hour) => (
          <div key={hour.toISOString()} className={styles.hourRow}>
            <div className={styles.timeLabel}>
              {format(hour, 'h a')}
            </div>
            <div className={styles.cell} onClick={() => handleCellClick(hour)}>
              {getEventsForHour(hour).map((event) => (
                <EventCard key={event.id} event={event} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
