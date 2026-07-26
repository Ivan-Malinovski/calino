import { memo, useMemo } from 'react'
import type { JSX } from 'react'
import { addMinutes, format, parseISO } from 'date-fns'
import { AnimatePresence, motion } from 'framer-motion'
import { useDndContext } from '@dnd-kit/core'
import type { CalendarEvent, Calendar } from '@/types'
import { EventCard } from './EventCard'
import { getEventColor } from '@/lib/eventColor'
import { formatTravelDuration } from '@/lib/events'
import { positionEvents } from '@/lib/eventPositioning'
import {
  positionedEventStyle,
  transparentEventStyle,
  travelBarStyle,
  taskPillStyle,
  TASK_PILL_LAYOUT_MINUTES,
} from '../lib/eventLayout'
import { eventCardVariants } from '../lib/eventAnimations'
import { useReducedMotion } from '@/hooks/useReducedMotion'
import styles from './WeekView.module.css'

interface WeekDayColumnProps {
  events: CalendarEvent[]
  fragments: CalendarEvent[]
  timedTasks: CalendarEvent[]
  calendars: Calendar[]
  hourHeight: number
  openModal: (start?: string, endDate?: string, eventId?: string, mode?: 'event' | 'task') => void
}

const WeekDayColumn = memo(function WeekDayColumn({
  events,
  fragments,
  timedTasks,
  calendars,
  hourHeight,
  openModal,
}: WeekDayColumnProps): JSX.Element {
  const reducedMotion = useReducedMotion()
  const enterTransition = { duration: reducedMotion ? 0 : 0.18, ease: 'easeOut' as const }
  // Reduced-motion handling matches the DayView / DayEventsPopup
  // pattern: skip the `initial` state entirely, opacity-only exit.
  const cardInitial = reducedMotion ? false : 'initial'
  const cardExit = reducedMotion ? { opacity: 0 } : 'exit'
  // Skip the exit animation when this event is the active drag — the
  // DragOverlay already shows the move visually, and the source exit
  // reads as a ghostly "jump back" to the original position.
  // Multi-day fragment draggables use `${event.id}::${date}` so strip
  // the date suffix to compare against `event.id`.
  const { active } = useDndContext()
  const activeMasterId = active ? active.id.toString().split('::')[0] : null
  const skipExit = (id: string): boolean => activeMasterId === id

  // Concatenating, sorting and running the overlap-positioning algorithm used
  // to happen on every render pass, including the ones driven by drag state
  // that can't change the layout. Only the data props affect it, so memoize on
  // exactly those — the JSX below still rebuilds, since it depends on the
  // active drag and reduced-motion. See #73.
  const { transparentEvents, taskById, positionedEvents } = useMemo(() => {
    const sorted = [...events, ...fragments].sort(
      (a, b) => parseISO(a.start).getTime() - parseISO(b.start).getTime()
    )

    // Timed tasks share the event column algorithm so overlapping items sit
    // side by side. They have zero duration, so `positionEvents` (strict
    // overlap test) would never collide them — give each a nominal interval
    // matching the pill's visual footprint for layout purposes only, and
    // render the original task.
    const byId = new Map(timedTasks.map((task) => [task.id, task]))
    const taskLayoutItems = timedTasks.map((task) => ({
      ...task,
      end: format(
        addMinutes(parseISO(task.start), TASK_PILL_LAYOUT_MINUTES),
        "yyyy-MM-dd'T'HH:mm:ss"
      ),
    }))

    return {
      transparentEvents: sorted.filter((e) => e.transparency === 'transparent'),
      taskById: byId,
      positionedEvents: positionEvents([...sorted, ...taskLayoutItems]),
    }
  }, [events, fragments, timedTasks])

  const elements: JSX.Element[] = []

  for (const event of transparentEvents) {
    const eventColor = getEventColor(event, { categories: [], calendars, useCategoryColors: false })
    const style = transparentEventStyle(event, 2)

    elements.push(
      <motion.div
        key={event.id}
        variants={eventCardVariants}
        initial={cardInitial}
        animate="animate"
        exit={skipExit(event.id) ? undefined : cardExit}
        transition={enterTransition}
        className={`${styles.eventPositioned} ${styles.eventTransparent}`}
        style={{ ...style, backgroundColor: `${eventColor}20` }}
      >
        <EventCard event={event} enableResize transparent hourHeight={hourHeight} />
      </motion.div>
    )
  }

  for (const { event, column, totalColumns } of positionedEvents) {
    const task = taskById.get(event.id)
    if (task) {
      elements.push(
        <motion.div
          key={task.id}
          variants={eventCardVariants}
          initial={cardInitial}
          animate="animate"
          exit={skipExit(task.id) ? undefined : cardExit}
          transition={enterTransition}
          className={`${styles.eventPositioned} ${styles.taskPositioned}`}
          style={taskPillStyle(task, column, totalColumns)}
        >
          <EventCard event={task} compact monthView enableResize={false} hideDueTime />
        </motion.div>
      )
      continue
    }

    const eventColor = getEventColor(event, { categories: [], calendars, useCategoryColors: false })

    if (event.travelDuration && event.travelDuration > 0) {
      elements.push(
        <motion.div
          key={`${event.id}-travel`}
          variants={eventCardVariants}
          initial={cardInitial}
          animate="animate"
          exit={skipExit(event.id) ? undefined : cardExit}
          transition={enterTransition}
          className={styles.travelBar}
          style={{
            ...travelBarStyle(event, column, totalColumns),
            backgroundColor: `${eventColor}15`,
          }}
          onClick={() => openModal(undefined, undefined, event.id)}
        >
          <span className={styles.travelBarInner}>
            {formatTravelDuration(event.travelDuration)} travel
          </span>
        </motion.div>
      )
    }

    elements.push(
      <motion.div
        key={event.id}
        variants={eventCardVariants}
        initial={cardInitial}
        animate="animate"
        exit={skipExit(event.id) ? undefined : cardExit}
        transition={enterTransition}
        className={styles.eventPositioned}
        style={positionedEventStyle(event, column, totalColumns)}
      >
        <EventCard
          event={event}
          enableResize
          hideTopRadius={!!event.travelDuration}
          hourHeight={hourHeight}
        />
      </motion.div>
    )
  }

  // `initial={false}` on AnimatePresence: only animate children that
  // join later (create, undo). Children that leave (delete) animate
  // out. Without this, the first mount animates every visible event
  // AND exit animations get confused with re-mounts.
  return <AnimatePresence initial={false}>{elements}</AnimatePresence>
})

export default WeekDayColumn
