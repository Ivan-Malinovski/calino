import type { JSX } from 'react'

import { useNavigate, useLocation } from 'react-router'
import { motion, type PanInfo } from 'framer-motion'
import { useCalendarStore } from '@/store/calendarStore'
import { hapticIfEnabled } from '@/lib/haptics'
import { useReducedMotion } from '@/hooks/useReducedMotion'
import { SettingsIcon, TuneIcon } from '@/components/common/icons'
import { QuickSettingsPanel } from '../QuickSettingsPanel'
import { VIEW_ROUTES, URL_TO_VIEW } from '../../viewRoutes'
import { useVisibleViews, useReorderViews } from '../../useOrderedViews'
import { useGridReorder } from './useGridReorder'
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

const gridVariants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.018 } },
}

// framer-motion animates via JS, so the global `prefers-reduced-motion` rule
// in src/index.css (CSS animation/transition durations only) does not reach
// these — the reduced-motion variants have to be supplied explicitly.
const gridVariantsReduced = {
  hidden: {},
  visible: { transition: { staggerChildren: 0 } },
}

const tileVariants = {
  hidden: { opacity: 0, scale: 0.9 },
  visible: { opacity: 1, scale: 1 },
}

const tileVariantsReduced = {
  hidden: { opacity: 1, scale: 1 },
  visible: { opacity: 1, scale: 1, transition: { duration: 0 } },
}

const TILE_INDICATOR_TRANSITION = { type: 'spring', stiffness: 500, damping: 40 } as const
const TILE_INDICATOR_TRANSITION_INSTANT = { duration: 0 } as const

export function NavExpandedGrid({
  quickSettingsOpen,
  onToggleQuickSettings,
  onOpenSearch,
  onCollapse,
  onDragProgress,
  onDragActiveChange,
}: NavExpandedGridProps): JSX.Element {
  const navigate = useNavigate()
  const location = useLocation()
  const setCurrentView = useCalendarStore((state) => state.setCurrentView)
  const reducedMotion = useReducedMotion()

  // currentView is store state that persists across routes (e.g. it still
  // says 'agenda' while on /settings), so the highlighted tile must be
  // derived from the actual route, not the stale store value.
  const activeView = URL_TO_VIEW[location.pathname]

  const visibleViews = useVisibleViews()
  const reorderViews = useReorderViews()
  const { reorderMode, draggingIndex, dragDelta, registerGrid, exitReorderMode, consumeDragClick } =
    useGridReorder(visibleViews.length, reorderViews)

  const activeTileIndex = visibleViews.findIndex(
    (v) => activeView === v.value || (v.value === 'week' && activeView === '3day')
  )

  const handleTileClick = (view: ViewType): void => {
    // The click that ends a long-press-drag must not also navigate.
    if (consumeDragClick()) return
    if (reorderMode) {
      exitReorderMode()
      return
    }
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

  // Swipe-to-dismiss must stand down while reordering. Setting `drag={false}`
  // is not enough on its own: framer starts the sheet's drag session on
  // pointerdown, which happens ~350ms *before* the long-press arms reorder
  // mode, and changing the prop mid-gesture doesn't cancel the session
  // already in flight. Dragging a tile down to the second row would then
  // release with offset.y past the dismiss threshold and close the sheet
  // out from under the reorder. Guarding the handlers covers both.
  const handleDragStart = (): void => {
    if (reorderMode) return
    onDragActiveChange?.(true)
  }

  const handleDrag = (_event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo): void => {
    if (reorderMode) return
    onDragProgress?.(Math.max(0, info.offset.y))
  }

  const handleDragEnd = (_event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo): void => {
    if (reorderMode) {
      // Leave the sheet exactly where it is, and reset anything the gesture
      // reported before reorder mode took over.
      onDragActiveChange?.(false)
      onDragProgress?.(0)
      return
    }
    const shouldClose = info.offset.y > 40 || info.velocity.y > 400
    onDragActiveChange?.(false)
    onDragProgress?.(0)
    if (shouldClose) onCollapse()
  }

  return (
    <motion.div
      className={styles.expanded}
      data-component="nav-expanded-grid"
      data-reorder-mode={reorderMode || undefined}
      // Swipe-to-dismiss has to yield while reordering, or dragging a tile
      // upwards would fight the sheet for the same gesture.
      drag={reorderMode ? false : 'y'}
      dragConstraints={{ top: 0, bottom: 0 }}
      dragElastic={{ top: 0, bottom: 0.06 }}
      onDragStart={handleDragStart}
      onDrag={handleDrag}
      onDragEnd={handleDragEnd}
    >
      <button
        type="button"
        className={styles.handle}
        onClick={onCollapse}
        aria-label="Collapse view switcher"
      />
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

      {reorderMode && (
        <div className={styles.reorderBar}>
          <span>Drag to rearrange</span>
          <button type="button" className={styles.reorderDone} onClick={exitReorderMode}>
            Done
          </button>
        </div>
      )}

      <motion.div
        className={styles.grid}
        ref={registerGrid}
        variants={reducedMotion ? gridVariantsReduced : gridVariants}
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
            transition={
              reducedMotion ? TILE_INDICATOR_TRANSITION_INSTANT : TILE_INDICATOR_TRANSITION
            }
          />
        )}
        {visibleViews.map((view, index) => {
          const isActive =
            activeView === view.value || (view.value === 'week' && activeView === '3day')
          const isHeld = draggingIndex === index
          return (
            <motion.button
              key={view.value}
              type="button"
              data-tile-index={index}
              data-held={isHeld || undefined}
              className={`${styles.tile} ${reorderMode ? styles.tileReordering : ''} ${
                isHeld ? styles.tileHeld : ''
              }`}
              style={{
                gridColumn: (index % 4) + 1,
                gridRow: Math.floor(index / 4) + 1,
                // The held tile is pinned to the finger; everything else
                // animates between cells via `layout`.
                x: isHeld ? dragDelta.x : 0,
                y: isHeld ? dragDelta.y : 0,
                zIndex: isHeld ? 3 : 1,
              }}
              // Layout animation would fight the pointer on the held tile.
              layout={!isHeld && !reducedMotion}
              transition={
                reducedMotion ? TILE_INDICATOR_TRANSITION_INSTANT : TILE_INDICATOR_TRANSITION
              }
              variants={reducedMotion ? tileVariantsReduced : tileVariants}
              onClick={() => handleTileClick(view.value)}
            >
              <span className={isActive ? styles.tileLabelActive : styles.tileLabel}>
                {view.label}
              </span>
            </motion.button>
          )
        })}
      </motion.div>
    </motion.div>
  )
}

function SearchIcon(): JSX.Element {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21L16.65 16.65" />
    </svg>
  )
}
