import { describe, it, expect, beforeEach } from 'vitest';
import { useCalendarStore } from '../calendarStore';

describe('calendarStore', () => {
  beforeEach(() => {
    const store = useCalendarStore.getState();
    store.events.forEach((e) => store.deleteEvent(e.id));
    const calendars = store.calendars.filter((c) => c.isDefault);
    calendars.forEach((c) => {
      if (!c.isDefault) store.deleteCalendar(c.id);
    });
  });

  describe('addEvent', () => {
    it('adds an event to the store', () => {
      const store = useCalendarStore.getState();
      const initialCount = store.events.length;

      store.addEvent({
        id: 'test-1',
        calendarId: 'default',
        title: 'Test Event',
        start: '2024-03-15T10:00:00',
        end: '2024-03-15T11:00:00',
        isAllDay: false,
      });

      expect(useCalendarStore.getState().events.length).toBe(initialCount + 1);
      expect(useCalendarStore.getState().events[0].title).toBe('Test Event');
    });
  });

  describe('updateEvent', () => {
    it('updates an existing event', () => {
      const store = useCalendarStore.getState();

      store.addEvent({
        id: 'test-2',
        calendarId: 'default',
        title: 'Original Title',
        start: '2024-03-15T10:00:00',
        end: '2024-03-15T11:00:00',
        isAllDay: false,
      });

      store.updateEvent('test-2', { title: 'Updated Title' });

      const updated = useCalendarStore.getState().events.find((e) => e.id === 'test-2');
      expect(updated?.title).toBe('Updated Title');
    });
  });

  describe('deleteEvent', () => {
    it('removes an event from the store', () => {
      const store = useCalendarStore.getState();

      store.addEvent({
        id: 'test-3',
        calendarId: 'default',
        title: 'To Delete',
        start: '2024-03-15T10:00:00',
        end: '2024-03-15T11:00:00',
        isAllDay: false,
      });

      store.deleteEvent('test-3');

      const exists = useCalendarStore.getState().events.find((e) => e.id === 'test-3');
      expect(exists).toBeUndefined();
    });
  });

  describe('getEventsForDateRange', () => {
    it('returns events within a date range', () => {
      const store = useCalendarStore.getState();

      store.addEvent({
        id: 'event-1',
        calendarId: 'default',
        title: 'Event 1',
        start: '2024-03-15T10:00:00',
        end: '2024-03-15T11:00:00',
        isAllDay: false,
      });

      store.addEvent({
        id: 'event-2',
        calendarId: 'default',
        title: 'Event 2',
        start: '2024-03-20T14:00:00',
        end: '2024-03-20T15:00:00',
        isAllDay: false,
      });

      const events = store.getEventsForDateRange('2024-03-15', '2024-03-15');
      expect(events.length).toBe(1);
      expect(events[0].title).toBe('Event 1');
    });

    it('excludes events from hidden calendars', () => {
      const store = useCalendarStore.getState();

      store.addCalendar({
        id: 'work',
        name: 'Work',
        color: '#FF0000',
        isVisible: false,
        isDefault: false,
      });

      store.addEvent({
        id: 'visible-event',
        calendarId: 'default',
        title: 'Visible Event',
        start: '2024-03-15T10:00:00',
        end: '2024-03-15T11:00:00',
        isAllDay: false,
      });

      store.addEvent({
        id: 'hidden-event',
        calendarId: 'work',
        title: 'Hidden Event',
        start: '2024-03-15T14:00:00',
        end: '2024-03-15T15:00:00',
        isAllDay: false,
      });

      const events = store.getEventsForDateRange('2024-03-15', '2024-03-15');
      expect(events.length).toBe(1);
      expect(events[0].title).toBe('Visible Event');
    });

    it('returns all-day events', () => {
      const store = useCalendarStore.getState();

      store.addEvent({
        id: 'allday',
        calendarId: 'default',
        title: 'All Day Event',
        start: '2024-03-15T00:00:00',
        end: '2024-03-15T23:59:59',
        isAllDay: true,
      });

      const events = store.getEventsForDateRange('2024-03-15', '2024-03-15');
      expect(events.length).toBe(1);
      expect(events[0].isAllDay).toBe(true);
    });
  });

  describe('calendar management', () => {
    it('adds a calendar', () => {
      const store = useCalendarStore.getState();
      const initialCount = store.calendars.length;

      store.addCalendar({
        id: 'personal',
        name: 'Personal',
        color: '#00FF00',
        isVisible: true,
        isDefault: false,
      });

      expect(useCalendarStore.getState().calendars.length).toBe(initialCount + 1);
    });

    it('toggles calendar visibility', () => {
      const store = useCalendarStore.getState();

      store.addCalendar({
        id: 'test-cal',
        name: 'Test',
        color: '#000000',
        isVisible: true,
        isDefault: false,
      });

      store.toggleCalendarVisibility('test-cal');

      const calendar = useCalendarStore.getState().calendars.find((c) => c.id === 'test-cal');
      expect(calendar?.isVisible).toBe(false);
    });

    it('deletes calendar and its events', () => {
      const store = useCalendarStore.getState();

      store.addCalendar({
        id: 'to-delete',
        name: 'To Delete',
        color: '#000000',
        isVisible: true,
        isDefault: false,
      });

      store.addEvent({
        id: 'event-to-delete',
        calendarId: 'to-delete',
        title: 'Event',
        start: '2024-03-15T10:00:00',
        end: '2024-03-15T11:00:00',
        isAllDay: false,
      });

      store.deleteCalendar('to-delete');

      const calendar = useCalendarStore.getState().calendars.find((c) => c.id === 'to-delete');
      const event = useCalendarStore.getState().events.find((e) => e.id === 'event-to-delete');

      expect(calendar).toBeUndefined();
      expect(event).toBeUndefined();
    });
  });

  describe('navigation', () => {
    it('sets current date', () => {
      const store = useCalendarStore.getState();
      store.setCurrentDate('2024-06-15');
      expect(useCalendarStore.getState().currentDate).toBe('2024-06-15');
    });

    it('sets current view', () => {
      const store = useCalendarStore.getState();
      store.setCurrentView('week');
      expect(useCalendarStore.getState().currentView).toBe('week');

      store.setCurrentView('day');
      expect(useCalendarStore.getState().currentView).toBe('day');

      store.setCurrentView('agenda');
      expect(useCalendarStore.getState().currentView).toBe('agenda');
    });
  });

  describe('modal', () => {
    it('opens modal with date', () => {
      const store = useCalendarStore.getState();
      store.openModal('2024-03-15');

      expect(useCalendarStore.getState().isModalOpen).toBe(true);
      expect(useCalendarStore.getState().selectedDate).toBe('2024-03-15');
    });

    it('opens modal without date', () => {
      const store = useCalendarStore.getState();
      store.openModal();

      expect(useCalendarStore.getState().isModalOpen).toBe(true);
      expect(useCalendarStore.getState().selectedDate).toBeNull();
    });

    it('closes modal', () => {
      const store = useCalendarStore.getState();
      store.openModal('2024-03-15');
      store.closeModal();

      expect(useCalendarStore.getState().isModalOpen).toBe(false);
      expect(useCalendarStore.getState().selectedEventId).toBeNull();
    });
  });
});
