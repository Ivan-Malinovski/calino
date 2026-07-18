import type { JSX } from 'react'
import { motion } from 'framer-motion'
import { useCalendarStore } from '@/store/calendarStore'
import { hapticIfEnabled } from '@/lib/haptics'
import { CalendarIcon, TaskCheckIcon } from '@/components/common/icons'
import styles from './NavCreateDrawer.module.css'

interface NavCreateDrawerProps {
  onClose: () => void
}

const rowVariants = {
  hidden: { opacity: 0, y: 6 },
  visible: { opacity: 1, y: 0 },
}

const containerVariants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.02 } },
}

export function NavCreateDrawer({ onClose }: NavCreateDrawerProps): JSX.Element {
  const handleNewEvent = (): void => {
    useCalendarStore.getState().openModal()
    hapticIfEnabled('light')
    onClose()
  }

  const handleNewTask = (): void => {
    useCalendarStore.getState().openModal(undefined, undefined, undefined, 'task')
    hapticIfEnabled('light')
    onClose()
  }

  const handleNewJournal = (): void => {
    const currentDate = useCalendarStore.getState().currentDate
    useCalendarStore.getState().openJournalModal(currentDate, true)
    hapticIfEnabled('light')
    onClose()
  }

  return (
    <div className={styles.drawer} data-component="nav-create-drawer">
      <button type="button" className={styles.handle} onClick={onClose} aria-label="Close create menu" />
      <motion.div className={styles.rows} variants={containerVariants} initial="hidden" animate="visible">
        <motion.button type="button" className={styles.row} variants={rowVariants} onClick={handleNewEvent}>
          <CalendarIcon size={18} />
          <span>New Event</span>
        </motion.button>
        <motion.button type="button" className={styles.row} variants={rowVariants} onClick={handleNewTask}>
          <TaskCheckIcon size={18} />
          <span>New Task</span>
        </motion.button>
        <motion.button type="button" className={styles.row} variants={rowVariants} onClick={handleNewJournal}>
          <JournalIcon />
          <span>New Journal Entry</span>
        </motion.button>
      </motion.div>
    </div>
  )
}

function JournalIcon(): JSX.Element {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19.5A2.5 2.5 0 016.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" />
      <path d="M9 7h7M9 11h7" />
    </svg>
  )
}
