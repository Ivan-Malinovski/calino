import type { JSX } from 'react';
import { format, parseISO } from 'date-fns';
import { useCalendarStore } from '@/store/calendarStore';
import type { CalendarEvent } from '@/types';
import styles from './EventCard.module.css';

interface EventCardProps {
  event: CalendarEvent;
  onClick?: (event: CalendarEvent) => void;
}

export function EventCard({ event, onClick }: EventCardProps): JSX.Element {
  const calendars = useCalendarStore((state) => state.calendars);
  const setSelectedEventId = useCalendarStore((state) => state.setSelectedEventId);
  const openModal = useCalendarStore((state) => state.openModal);

  const calendar = calendars.find((c) => c.id === event.calendarId);
  const eventColor = event.color || calendar?.color || '#4285F4';

  const handleClick = (): void => {
    if (onClick) {
      onClick(event);
    } else {
      setSelectedEventId(event.id);
      openModal();
    }
  };

  const formatTime = (dateString: string): string => {
    return format(parseISO(dateString), 'h:mm a');
  };

  return (
    <div
      className={styles.card}
      style={{ backgroundColor: `${eventColor}20`, borderLeftColor: eventColor }}
      onClick={handleClick}
    >
      <div className={styles.title}>{event.title}</div>
      {!event.isAllDay && (
        <div className={styles.time}>
          {formatTime(event.start)} - {formatTime(event.end)}
        </div>
      )}
      {event.isAllDay && <div className={styles.time}>All day</div>}
      {event.location && <div className={styles.location}>{event.location}</div>}
    </div>
  );
}
