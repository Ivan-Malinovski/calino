import type { JSX } from 'react'
import { format, parseISO } from 'date-fns'
import { useCalendarStore } from '@/store/calendarStore'
import type { SearchResult } from '../types'
import styles from './SearchResults.module.css'

interface SearchResultsProps {
  results: SearchResult[]
  onSelectEvent: (eventId: string) => void
}

function HighlightedText({
  text,
  indices,
}: {
  text: string
  indices: [number, number][]
}): JSX.Element {
  if (!indices || indices.length === 0) {
    return <>{text}</>
  }

  const parts: JSX.Element[] = []
  let lastIndex = 0

  indices.forEach(([start, end], index) => {
    if (start > lastIndex) {
      parts.push(<span key={`text-${index}`}>{text.slice(lastIndex, start)}</span>)
    }
    parts.push(
      <span key={`highlight-${index}`} className={styles.resultTitleHighlight}>
        {text.slice(start, end + 1)}
      </span>
    )
    lastIndex = end + 1
  })

  if (lastIndex < text.length) {
    parts.push(<span key="text-last">{text.slice(lastIndex)}</span>)
  }

  return <>{parts}</>
}

function formatEventDate(start: string, end: string, isAllDay: boolean): string {
  const startDate = parseISO(start)
  const endDate = parseISO(end)

  if (isAllDay) {
    return format(startDate, 'MMM d, yyyy')
  }

  const sameDay = format(startDate, 'yyyy-MM-dd') === format(endDate, 'yyyy-MM-dd')

  if (sameDay) {
    return `${format(startDate, 'MMM d')} · ${format(startDate, 'h:mm a')} - ${format(endDate, 'h:mm a')}`
  }

  return `${format(startDate, 'MMM d, h:mm a')} - ${format(endDate, 'MMM d, h:mm a')}`
}

export function SearchResults({ results, onSelectEvent }: SearchResultsProps): JSX.Element | null {
  const calendars = useCalendarStore((state) => state.calendars)

  const getCalendarColor = (calendarId: string): string => {
    const calendar = calendars.find((c) => c.id === calendarId)
    return calendar?.color ?? '#4285f4'
  }

  if (results.length === 0) {
    return (
      <div className={styles.resultsContainer}>
        <div className={styles.noResults}>
          <svg
            className={styles.noResultsIcon}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
          <p className={styles.noResultsTitle}>No events found</p>
          <p className={styles.noResultsText}>Try searching for something else</p>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.resultsContainer}>
      <div className={styles.resultsCount}>
        {results.length} event{results.length !== 1 ? 's' : ''} found
      </div>
      {results.map((result) => {
        const titleMatch = result.matches.find((m) => m.field === 'title')
        const locationMatch = result.matches.find((m) => m.field === 'location')

        return (
          <div
            key={result.event.id}
            className={styles.resultItem}
            onClick={() => onSelectEvent(result.event.id)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                onSelectEvent(result.event.id)
              }
            }}
          >
            <div
              className={styles.colorIndicator}
              style={{ backgroundColor: getCalendarColor(result.event.calendarId) }}
            />
            <div className={styles.resultContent}>
              <h4 className={styles.resultTitle}>
                {titleMatch ? (
                  <HighlightedText text={result.event.title} indices={titleMatch.indices} />
                ) : (
                  result.event.title
                )}
              </h4>
              <div className={styles.resultMeta}>
                <span className={styles.resultDate}>
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <rect width="18" height="18" x="3" y="4" rx="2" ry="2" />
                    <line x1="16" x2="16" y1="2" y2="6" />
                    <line x1="8" x2="8" y1="2" y2="6" />
                    <line x1="3" x2="21" y1="10" y2="10" />
                  </svg>
                  {formatEventDate(result.event.start, result.event.end, result.event.isAllDay)}
                </span>
                {result.event.location && (
                  <span className={styles.resultLocation}>
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
                      <circle cx="12" cy="10" r="3" />
                    </svg>
                    {locationMatch ? (
                      <HighlightedText
                        text={result.event.location}
                        indices={locationMatch.indices}
                      />
                    ) : (
                      result.event.location
                    )}
                  </span>
                )}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
