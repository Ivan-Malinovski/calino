import type { JSX } from 'react'
import { motion, type PanInfo } from 'framer-motion'
import { Capacitor } from '@capacitor/core'
import { useCalendarStore } from '@/store/calendarStore'
import { useAIVisionSettingsStore } from '@/store/aiVisionSettingsStore'
import { useAIPhotoImport } from '@/features/aiVision/useAIPhotoImport'
import { hapticIfEnabled } from '@/lib/haptics'
import { useReducedMotion } from '@/hooks/useReducedMotion'
import { CalendarIcon, TaskCheckIcon } from '@/components/common/icons'
import styles from './NavCreateDrawer.module.css'

interface NavCreateDrawerProps {
  onClose: () => void
  onDragProgress?: (y: number) => void
  onDragActiveChange?: (active: boolean) => void
}

const rowVariants = {
  hidden: { opacity: 0, y: 6 },
  visible: { opacity: 1, y: 0 },
}

const containerVariants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.02 } },
}

// framer-motion animates via JS, so the global `prefers-reduced-motion` rule
// in src/index.css (CSS animation/transition durations only) does not reach
// these — the reduced-motion variants have to be supplied explicitly.
const rowVariantsReduced = {
  hidden: { opacity: 1, y: 0 },
  visible: { opacity: 1, y: 0, transition: { duration: 0 } },
}

const containerVariantsReduced = {
  hidden: {},
  visible: { transition: { staggerChildren: 0 } },
}

const isNative = Capacitor.isNativePlatform()

export function NavCreateDrawer({
  onClose,
  onDragProgress,
  onDragActiveChange,
}: NavCreateDrawerProps): JSX.Element {
  const { aiState, importFromCamera } = useAIPhotoImport()
  const hasAiApiKey = useAIVisionSettingsStore((s) => s.apiKeyEncrypted !== null)
  const reducedMotion = useReducedMotion()
  const rows = reducedMotion ? rowVariantsReduced : rowVariants
  const container = reducedMotion ? containerVariantsReduced : containerVariants

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

  // The review modal itself is rendered once at the app root (AIPhotoImportRoot)
  // so it also works for photos shared in from other apps. The drawer closes
  // as soon as processing settles (review picker appears, or a toast explains
  // the failure) rather than lingering open behind it.
  const handleAIImport = (): void => {
    void importFromCamera(onClose)
  }

  const handleDrag = (_event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo): void => {
    onDragProgress?.(Math.max(0, info.offset.y))
  }

  const handleDragEnd = (_event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo): void => {
    const shouldClose = info.offset.y > 40 || info.velocity.y > 400
    onDragActiveChange?.(false)
    onDragProgress?.(0)
    if (shouldClose) onClose()
  }

  const aiBusy = aiState === 'capturing' || aiState === 'processing'

  return (
    <motion.div
      className={styles.drawer}
      data-component="nav-create-drawer"
      drag="y"
      dragConstraints={{ top: 0, bottom: 0 }}
      dragElastic={{ top: 0, bottom: 0.06 }}
      onDragStart={() => onDragActiveChange?.(true)}
      onDrag={handleDrag}
      onDragEnd={handleDragEnd}
    >
      <button
        type="button"
        className={styles.handle}
        onClick={onClose}
        aria-label="Close create menu"
      />
      <motion.div className={styles.rows} variants={container} initial="hidden" animate="visible">
        <motion.div className={styles.rowWrapper} variants={rows}>
          <button type="button" className={styles.rowMain} onClick={handleNewEvent}>
            <CalendarIcon size={18} />
            <span>New Event</span>
          </button>
          {isNative && hasAiApiKey && (
            <button
              type="button"
              className={styles.rowAction}
              onClick={handleAIImport}
              disabled={aiBusy}
              aria-label="Import event from photo"
            >
              {aiBusy ? <span className={styles.rowActionSpinner} /> : <AIPhotoIcon />}
            </button>
          )}
        </motion.div>
        <motion.button type="button" className={styles.row} variants={rows} onClick={handleNewTask}>
          <TaskCheckIcon size={18} />
          <span>New Task</span>
        </motion.button>
        <motion.button
          type="button"
          className={styles.row}
          variants={rows}
          onClick={handleNewJournal}
        >
          <JournalIcon />
          <span>New Journal Entry</span>
        </motion.button>
      </motion.div>
    </motion.div>
  )
}

function JournalIcon(): JSX.Element {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 19.5A2.5 2.5 0 016.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" />
      <path d="M9 7h7M9 11h7" />
    </svg>
  )
}

function AIPhotoIcon(): JSX.Element {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" />
      <circle cx="12" cy="13" r="4" />
      <path d="M19 2v4M17 4h4" strokeLinecap="round" />
    </svg>
  )
}
