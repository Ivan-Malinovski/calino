import { describe, it, expect } from 'vitest';
import { extractTitle } from '../parser/extractTitle';
import { extractDuration, extractRecurrence } from '../parser/extractDuration';
import { extractLocation } from '../parser/extractLocation';
import { parseNaturalLanguage } from '../parser/NLParser';

describe('extractTitle', () => {
  it('extracts simple title', () => {
    expect(extractTitle('Meeting tomorrow at 2pm', 'tomorrow at 2pm')).toBe('Meeting');
  });

  it('extracts title with "at" keyword', () => {
    expect(extractTitle('Lunch with mom at noon', 'noon')).toBe('Lunch with mom');
  });

  it('extracts title with date', () => {
    expect(extractTitle('dentist appointment on March 15', 'March 15')).toBe('Dentist appointment');
  });

  it('returns "New Event" for empty input', () => {
    expect(extractTitle('', '')).toBe('New Event');
  });

  it('capitalizes first letter', () => {
    expect(extractTitle('team standup at 9am', '9am')).toBe('Team standup');
  });
});

describe('extractDuration', () => {
  it('extracts hours', () => {
    expect(extractDuration('meeting for 2 hours')).toBe(120);
  });

  it('extracts minutes', () => {
    expect(extractDuration('30 minutes meeting')).toBe(30);
  });

  it('extracts hours and minutes', () => {
    expect(extractDuration('meeting for 2 hours and 30 minutes')).toBe(150);
  });

  it('extracts days', () => {
    expect(extractDuration('conference for 3 days')).toBe(4320);
  });

  it('returns default for no duration', () => {
    expect(extractDuration('meeting at 2pm')).toBe(60);
  });

  it('uses custom default', () => {
    expect(extractDuration('meeting at 2pm', 30)).toBe(30);
  });
});

describe('extractRecurrence', () => {
  it('detects daily recurrence', () => {
    const result = extractRecurrence('meeting every day');
    expect(result?.frequency).toBe('daily');
    expect(result?.interval).toBe(1);
  });

  it('detects weekly recurrence', () => {
    const result = extractRecurrence('team standup every week');
    expect(result?.frequency).toBe('weekly');
    expect(result?.interval).toBe(1);
  });

  it('detects monthly recurrence', () => {
    const result = extractRecurrence('bill monthly');
    expect(result?.frequency).toBe('monthly');
    expect(result?.interval).toBe(1);
  });

  it('detects yearly recurrence', () => {
    const result = extractRecurrence('anniversary yearly');
    expect(result?.frequency).toBe('yearly');
  });

  it('detects weekday recurrence', () => {
    const result = extractRecurrence('standup every weekday');
    expect(result?.frequency).toBe('weekly');
    expect(result?.byWeekday).toEqual([1, 2, 3, 4, 5]);
  });

  it('returns null for non-recurring', () => {
    expect(extractRecurrence('meeting tomorrow')).toBeNull();
  });
});

describe('extractLocation', () => {
  it('extracts location with "at" keyword', () => {
    expect(extractLocation('Meeting at coffee shop')).toBe('coffee shop');
  });

  it('returns undefined for no location', () => {
    expect(extractLocation('Meeting tomorrow')).toBeUndefined();
  });
});

describe('NLParser', () => {
  it('parses simple date and time', () => {
    const result = parseNaturalLanguage('Meeting tomorrow at 2pm');
    expect(result.title).toBe('Meeting');
    expect(result.confidence).toBeGreaterThan(0.5);
    expect(result.isAllDay).toBe(false);
  });

  it('parses date only', () => {
    const result = parseNaturalLanguage('dentist appointment on March 15');
    expect(result.title).toBe('Dentist appointment');
    expect(result.isAllDay).toBe(true);
  });

  it('parses duration', () => {
    const result = parseNaturalLanguage('Meeting for 2 hours starting at 3pm');
    expect(result.duration).toBe(120);
  });

  it('parses location', () => {
    const result = parseNaturalLanguage('Lunch at downtown cafe');
    expect(result.location).toBe('downtown cafe');
  });

  it('parses recurring event', () => {
    const result = parseNaturalLanguage('team standup every weekday at 9am');
    expect(result.recurrence).toBeDefined();
    expect(result.recurrence?.frequency).toBe('weekly');
  });

  it('handles empty input', () => {
    const result = parseNaturalLanguage('');
    expect(result.title).toBe('New Event');
    expect(result.confidence).toBe(0);
  });

  it('parses relative dates', () => {
    const result = parseNaturalLanguage('meeting next Thursday');
    expect(result.title).toBe('Meeting');
    expect(result.isAllDay).toBe(true);
  });

  it('parses time keywords', () => {
    const result = parseNaturalLanguage('lunch at noon');
    expect(result.title).toBe('Lunch');
    expect(result.isAllDay).toBe(false);
  });
});
