import type { JSX } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, type PanInfo } from 'framer-motion'
import { useCalendarStore } from '@/store/calendarStore'
import { useSettingsStore } from '@/store/settingsStore'
import { hapticIfEnabled } from '@/lib/haptics'
import { SettingsIcon, TuneIcon } from '@/components/common/icons'
import { QuickSettingsPanel } from '../QuickSettingsPanel'
import { VIEW_ROUTES } from '../../viewRoutes'
import type { ViewType } from '@/types'
import styles from './NavExpandedGrid.module.css'

interface NavExpandedGridProps {
  quickSettingsOpen: boolean
  onToggleQuickSettings: () => void
  onOpenSearch: () => void
  onCollapse: () => void
  onDragProgress?: (y: number) => void
  onDragActiveChange?: (active: boolean) => void
}

const GRID_VIEWS: { value: ViewType; label: string }[] = [
  { value: 'month', label: 'Month' },
  { value: 'week', label: 'Week' },
  { value: 'agenda', label: 'Agenda' },
  { value: 'year', label: 'Year' },
  { value: 'day', label: 'Day' },
  { value: 'todo', label: 'Tasks' },
  { value: 'journal', label: 'Journal' },
  { value: 'contacts', label: 'Contacts' },
]

const gridVariants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.018 } },
}

const tileVariants = {
  hidden: { opacity: 0, scale: 0.9 },
  visible: { opacity: 1, scale: 1 },
}

const TILE_INDICATOR_TRANSITION = { type: 'spring', stiffness: 500, damping: 40 } as const

export function NavExpandedGrid({
  quickSettingsOpen,
  onToggleQuickSettings,
  onOpenSearch,
  onCollapse,
  onDragProgress,
  onDragActiveChange,
}: NavExpandedGridProps): JSX.Element {
  const navigate = useNavigate()
  const currentView = useCalendarStore((state) => state.currentView)
  const setCurrentView = useCalendarStore((state) => state.setCurrentView)
  const journalEnabled = useSettingsStore((state) => state.journalEnabled)
  const contactsEnabled = useSettingsStore((state) => state.contactsEnabled)

  const visibleViews = GRID_VIEWS.filter(
    (v) => (journalEnabled || v.value !== 'journal') && (contactsEnabled || v.value !== 'contacts')
  )

  const activeTileIndex = visibleViews.findIndex(
    (v) => currentView === v.value || (v.value === 'week' && currentView === '3day')
  )

  const handleTileClick = (view: ViewType): void => {
    setCurrentView(view)
    navigate(VIEW_ROUTES[view])
    hapticIfEnabled('light')
    onCollapse()
  }

  const handleSearchClick = (): void => {
    onOpenSearch()
    onCollapse()
  }

  const handleSettingsClick = (): void => {
    navigate('/settings')
    onCollapse()
  }

  const handleDrag = (_event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo): void => {
    onDragProgress?.(Math.max(0, info.offset.y))
  }

  const handleDragEnd = (_event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo): void => {
    const shouldClose = info.offset.y > 40 || info.velocity.y > 400
    onDragActiveChange?.(false)
    onDragProgress?.(0)
    if (shouldClose) onCollapse()
  }

  return (
    <motion.div
      className={styles.expanded}
      data-component="nav-expanded-grid"
      drag="y"
      dragConstraints={{ top: 0, bottom: 0 }}
      dragElastic={{ top: 0, bottom: 0.06 }}
      onDragStart={() => onDragActiveChange?.(true)}
      onDrag={handleDrag}
      onDragEnd={handleDragEnd}
    >
      <button type="button" className={styles.handle} onClick={onCollapse} aria-label="Collapse view switcher" />
      <div className={styles.utilityRow}>
        <button type="button" className={styles.searchTile} onClick={handleSearchClick}>
          <SearchIcon />
          <span>Search</span>
        </button>
        <div className={styles.settingsTile}>
          <button type="button" className={styles.settingsZone} onClick={handleSettingsClick}>
            <SettingsIcon size={14} />
            <span>Settings</span>
          </button>
          <button
            type="button"
            className={`${styles.settingsToggleZone} ${quickSettingsOpen ? styles.settingsToggleZoneActive : ''}`}
            onClick={onToggleQuickSettings}
            aria-label="Quick settings"
            aria-expanded={quickSettingsOpen}
          >
            <TuneIcon size={16} />
          </button>
        </div>
      </div>

      {quickSettingsOpen && (
        <div className={styles.quickSettingsCard}>
          <QuickSettingsPanel onNavigate={onCollapse} hideAllSettingsLink />
        </div>
      )}

      <motion.div
        className={styles.grid}
        variants={gridVariants}
        initial="hidden"
        animate="visible"
      >
        {activeTileIndex >= 0 && (
          <motion.div
            layoutId="nav-active-indicator"
            className={styles.tileActiveBg}
            style={{
              gridColumn: (activeTileIndex % 4) + 1,
              gridRow: Math.floor(activeTileIndex / 4) + 1,
            }}
            transition={TILE_INDICATOR_TRANSITION}
          />
        )}
        {visibleViews.map((view, index) => {
          const isActive = currentView === view.value || (view.value === 'week' && currentView === '3day')
          return (
            <motion.button
              key={view.value}
              type="button"
              className={styles.tile}
              style={{ gridColumn: (index % 4) + 1, gridRow: Math.floor(index / 4) + 1 }}
              variants={tileVariants}
              onClick={() => handleTileClick(view.value)}
            >
              <span className={isActive ? styles.tileLabelActive : styles.tileLabel}>{view.label}</span>
            </motion.button>
          )
        })}
      </motion.div>
    </motion.div>
  )
}

function SearchIcon(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21L16.65 16.65" />
    </svg>
  )
}
