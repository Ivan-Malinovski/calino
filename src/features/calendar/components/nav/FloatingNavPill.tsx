import type { JSX } from 'react'
import { useState, useCallback, useRef, useEffect, useLayoutEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { motion, useMotionValue, animate, type PanInfo } from 'framer-motion'
import { useCalendarStore } from '@/store/calendarStore'
import { useSettingsStore } from '@/store/settingsStore'
import { hapticIfEnabled } from '@/lib/haptics'
import { useTextInputFocused } from '@/hooks/useTextInputFocused'
import { VIEW_ROUTES, URL_TO_VIEW, ALL_VIEWS } from '../../viewRoutes'
import type { ViewType } from '@/types'
import { NavExpandedGrid } from './NavExpandedGrid'
import { NavCreateDrawer } from './NavCreateDrawer'
import styles from './FloatingNavPill.module.css'

interface FloatingNavPillProps {
  onToggleSidebar: () => void
  onOpenSearch: () => void
}

const BASE_VIEWS: { value: ViewType; label: string }[] = [
  { value: 'month', label: 'Month' },
  { value: 'week', label: 'Week' },
  { value: 'agenda', label: 'Agenda' },
]

const PILL_TRANSITION = { duration: 0.24, ease: [0.65, 0, 0.35, 1] as const }
const CHROME_TRANSITION = { duration: 0.19 }
const INDICATOR_TRANSITION = { type: 'spring', stiffness: 500, damping: 40 } as const

export function FloatingNavPill({ onToggleSidebar, onOpenSearch }: FloatingNavPillProps): JSX.Element {
  const navigate = useNavigate()
  const location = useLocation()
  const currentView = useCalendarStore((state) => state.currentView)
  const setCurrentView = useCalendarStore((state) => state.setCurrentView)
  const journalEnabled = useSettingsStore((state) => state.journalEnabled)
  const contactsEnabled = useSettingsStore((state) => state.contactsEnabled)

  // On-screen keyboard opening resizes the visual viewport, which drags a
  // `position: fixed` bottom pill up the screen along with it — there's
  // nothing useful for it to do while typing (e.g. a /journal entry), so
  // just tuck it away instead of letting it jump around.
  const textInputFocused = useTextInputFocused()

  // The collapsed pill shows the 3 base views (Month/Week/Agenda) inline as
  // a quick selector. On any other route (e.g. /settings, /year, /day,
  // /tasks, /journal, /contacts) those buttons aren't useful — the user
  // picks a view via the "..." menu's expanded grid instead, which already
  // lists all 8 views.
  const isOnBaseRoute =
    location.pathname === '/month' ||
    location.pathname === '/week' ||
    location.pathname === '/agenda'

  const isOnSettingsRoute = location.pathname === '/settings'

  const [viewSwitcherExpanded, setViewSwitcherExpanded] = useState(false)
  const [quickSettingsOpen, setQuickSettingsOpen] = useState(false)
  const [createDrawerOpen, setCreateDrawerOpen] = useState(false)

  const contentRef = useRef<HTMLDivElement>(null)
  const [measuredHeight, setMeasuredHeight] = useState<number>(0)
  const collapsedHeightRef = useRef(0)
  const measuredHeightRef = useRef(0)
  const isDraggingRef = useRef(false)
  const heightMV = useMotionValue(0)
  const radiusMV = useMotionValue(34)

  const pillRadius = createDrawerOpen ? 26 : viewSwitcherExpanded ? 30 : 34

  // Passive ResizeObserver — catches content-size changes not driven by the
  // open/create toggles below (e.g. the quick-settings panel expanding
  // inside the view grid).
  useLayoutEffect(() => {
    const el = contentRef.current
    if (!el) return

    const updateHeight = (): void => {
      setMeasuredHeight(el.getBoundingClientRect().height)
    }

    updateHeight()

    const observer = new ResizeObserver(updateHeight)
    observer.observe(el)

    return () => observer.disconnect()
  }, [])

  // Force a synchronous re-measurement the instant the open/create state
  // itself changes, so `measuredHeight` lands in the SAME commit as the new
  // `pillRadius` instead of trailing a tick behind via the async
  // ResizeObserver callback above. Without this, that callback and the
  // effect below both ended up calling animate(heightMV, ...) back to back
  // with slightly different targets, restarting the tween mid-flight and
  // producing a visible overshoot ("stretches then snaps back").
  useLayoutEffect(() => {
    const el = contentRef.current
    if (!el) return
    setMeasuredHeight(el.getBoundingClientRect().height)
  }, [viewSwitcherExpanded, createDrawerOpen])

  useLayoutEffect(() => {
    if (!viewSwitcherExpanded && !createDrawerOpen) {
      collapsedHeightRef.current = measuredHeight
    }
  }, [measuredHeight, viewSwitcherExpanded, createDrawerOpen])

  // Single source of truth for animating height + radius together, so they
  // always start and finish in lockstep.
  useEffect(() => {
    measuredHeightRef.current = measuredHeight
    if (isDraggingRef.current) return
    const heightControls = animate(heightMV, measuredHeight, PILL_TRANSITION)
    const radiusControls = animate(radiusMV, pillRadius, PILL_TRANSITION)
    return () => {
      heightControls.stop()
      radiusControls.stop()
    }
  }, [measuredHeight, pillRadius, heightMV, radiusMV])

  const handlePillDragProgress = useCallback(
    (y: number) => {
      heightMV.set(Math.max(collapsedHeightRef.current, measuredHeightRef.current - y))
    },
    [heightMV]
  )

  const handlePillDragActiveChange = useCallback(
    (active: boolean) => {
      isDraggingRef.current = active
      if (!active) {
        animate(heightMV, measuredHeightRef.current, PILL_TRANSITION)
      }
    },
    [heightMV]
  )

  const collapseAll = useCallback(() => {
    setViewSwitcherExpanded(false)
    setQuickSettingsOpen(false)
    setCreateDrawerOpen(false)
  }, [])

  const handleToggleSidebarClick = useCallback(() => {
    collapseAll()
    onToggleSidebar()
  }, [collapseAll, onToggleSidebar])

  const handleToggleSwitcher = useCallback(() => {
    setCreateDrawerOpen(false)
    setViewSwitcherExpanded((prev) => {
      const next = !prev
      if (!next) setQuickSettingsOpen(false)
      return next
    })
  }, [])

  const handleBaseRowDragEnd = useCallback(
    (_event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
      if (info.offset.y < -40 || info.velocity.y < -400) {
        setCreateDrawerOpen(false)
        setViewSwitcherExpanded(true)
      }
    },
    []
  )

  const handleToggleCreate = useCallback(() => {
    setViewSwitcherExpanded(false)
    setQuickSettingsOpen(false)
    setCreateDrawerOpen((prev) => !prev)
  }, [])

  const handleViewChange = useCallback(
    (view: ViewType) => {
      setCurrentView(view)
      navigate(VIEW_ROUTES[view], { replace: true })
      hapticIfEnabled('light')
    },
    [setCurrentView, navigate]
  )

  const activeIndex = BASE_VIEWS.findIndex(
    (view) => currentView === view.value || (view.value === 'week' && currentView === '3day')
  )

  // Swiping the collapsed pill steps through ALL views (not just the 3 base
  // ones shown inline), in the same order as the "..." expanded grid, and
  // works from any route — so e.g. /agenda -> /year -> /day.
  const swipeViews = ALL_VIEWS.filter(
    (v) => (journalEnabled || v.value !== 'journal') && (contactsEnabled || v.value !== 'contacts')
  )
  const swipeActiveView = URL_TO_VIEW[location.pathname] ?? currentView
  const swipeActiveIndex = swipeViews.findIndex(
    (v) => swipeActiveView === v.value || (v.value === 'week' && swipeActiveView === '3day')
  )

  const handleSwitcherPanEnd = useCallback(
    (_event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
      if (swipeActiveIndex < 0) return
      if (Math.abs(info.offset.x) < Math.abs(info.offset.y)) return
      const SWIPE_OFFSET_THRESHOLD = 40
      const SWIPE_VELOCITY_THRESHOLD = 400
      if (
        Math.abs(info.offset.x) < SWIPE_OFFSET_THRESHOLD &&
        Math.abs(info.velocity.x) < SWIPE_VELOCITY_THRESHOLD
      ) {
        return
      }
      const nextIndex =
        (swipeActiveIndex + (info.offset.x < 0 ? 1 : -1) + swipeViews.length) % swipeViews.length
      handleViewChange(swipeViews[nextIndex].value)
    },
    [swipeActiveIndex, swipeViews, handleViewChange]
  )

  return (
    <>
      {viewSwitcherExpanded && (
        <div className={styles.tapCatcher} onClick={collapseAll} aria-hidden="true" />
      )}
      <motion.div
        className={`${styles.pill} ${textInputFocused ? styles.pillHidden : ''}`}
        style={{ height: heightMV, borderRadius: radiusMV }}
        animate={{ opacity: textInputFocused ? 0 : 1, y: textInputFocused ? 24 : 0 }}
        transition={CHROME_TRANSITION}
        data-component="floating-nav-pill"
      >
        <div ref={contentRef} className={styles.pillContent}>
          {createDrawerOpen && (
            <NavCreateDrawer
              onClose={() => setCreateDrawerOpen(false)}
              onDragProgress={handlePillDragProgress}
              onDragActiveChange={handlePillDragActiveChange}
            />
          )}

          <motion.div
            className={
              viewSwitcherExpanded ? `${styles.baseRow} ${styles.baseRowExpanded}` : styles.baseRow
            }
            drag={!viewSwitcherExpanded && !createDrawerOpen ? 'y' : false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0.06, bottom: 0 }}
            onDragEnd={handleBaseRowDragEnd}
          >
            <motion.button
              type="button"
              className={styles.hamburgerBtn}
              onClick={handleToggleSidebarClick}
              animate={{ width: viewSwitcherExpanded ? 0 : 44, opacity: viewSwitcherExpanded ? 0 : 1 }}
              transition={CHROME_TRANSITION}
              aria-label={isOnSettingsRoute ? 'Back to calendar' : 'Toggle sidebar'}
            >
              {isOnSettingsRoute ? <BackArrowIcon /> : <HamburgerIcon />}
            </motion.button>

            <div className={styles.switcherSegment} data-component="nav-pill-switcher">
              {viewSwitcherExpanded ? (
                <NavExpandedGrid
                  quickSettingsOpen={quickSettingsOpen}
                  onToggleQuickSettings={() => setQuickSettingsOpen((prev) => !prev)}
                  onOpenSearch={onOpenSearch}
                  onCollapse={collapseAll}
                  onDragProgress={handlePillDragProgress}
                  onDragActiveChange={handlePillDragActiveChange}
                />
              ) : (
                <motion.div
                  className={styles.switcherTrack}
                  style={{ touchAction: 'none' }}
                  onPanEnd={handleSwitcherPanEnd}
                >
                  {isOnBaseRoute && activeIndex >= 0 && (
                    <motion.div
                      layoutId="nav-active-indicator"
                      className={styles.switcherActiveBg}
                      style={{ gridColumn: activeIndex + 1, gridRow: 1 }}
                      transition={INDICATOR_TRANSITION}
                    />
                  )}
                  {!isOnBaseRoute && (
                    <motion.div
                      layoutId="nav-active-indicator"
                      className={styles.switcherActiveBg}
                      style={{ gridColumn: BASE_VIEWS.length + 1, gridRow: 1 }}
                      transition={INDICATOR_TRANSITION}
                    />
                  )}
                  {BASE_VIEWS.map((view, index) => {
                    const isActive =
                      isOnBaseRoute &&
                      (currentView === view.value || (view.value === 'week' && currentView === '3day'))
                    return (
                      <button
                        key={view.value}
                        type="button"
                        className={styles.switcherBtn}
                        style={{ gridColumn: index + 1 }}
                        onClick={() => handleViewChange(view.value)}
                      >
                        <span className={isActive ? styles.switcherLabelActive : styles.switcherLabel}>
                          {view.label}
                        </span>
                      </button>
                    )
                  })}
                  <button
                    type="button"
                    className={styles.switcherBtn}
                    style={{ gridColumn: BASE_VIEWS.length + 1 }}
                    onClick={handleToggleSwitcher}
                    aria-label="Show all views"
                    aria-expanded={viewSwitcherExpanded}
                  >
                    <span className={isOnBaseRoute ? styles.switcherLabel : styles.switcherLabelActive}>
                      <EllipsisIcon />
                    </span>
                  </button>
                </motion.div>
              )}
            </div>

            <motion.button
              type="button"
              className={styles.createBtn}
              onClick={handleToggleCreate}
              animate={{ width: viewSwitcherExpanded ? 0 : 38, opacity: viewSwitcherExpanded ? 0 : 1 }}
              transition={CHROME_TRANSITION}
              aria-label={createDrawerOpen ? 'Close create menu' : 'Create'}
              aria-expanded={createDrawerOpen}
            >
              <motion.span
                className={styles.createIcon}
                animate={{ rotate: createDrawerOpen ? 45 : 0 }}
                transition={CHROME_TRANSITION}
              >
                <PlusIcon />
              </motion.span>
            </motion.button>
          </motion.div>
        </div>
      </motion.div>
    </>
  )
}

function HamburgerIcon(): JSX.Element {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M3 10H17M3 6H17M3 14H17" />
    </svg>
  )
}

function BackArrowIcon(): JSX.Element {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 4L6 10l6 6" />
    </svg>
  )
}

function EllipsisIcon(): JSX.Element {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor">
      <circle cx="4" cy="10" r="1.8" />
      <circle cx="10" cy="10" r="1.8" />
      <circle cx="16" cy="10" r="1.8" />
    </svg>
  )
}

function PlusIcon(): JSX.Element {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
      <path d="M10 3V17M3 10H17" />
    </svg>
  )
}
