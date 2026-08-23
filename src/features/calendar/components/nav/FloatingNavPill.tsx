import type { JSX, CSSProperties } from 'react'
import { useState, useCallback, useRef, useEffect, useLayoutEffect } from 'react'
import { useNavigate, useLocation } from 'react-router'
import { motion, useMotionValue, animate, type PanInfo } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { useCalendarStore } from '@/store/calendarStore'
import { useSettingsStore } from '@/store/settingsStore'
import { hapticIfEnabled } from '@/lib/haptics'
import { useTextInputFocused } from '@/hooks/useTextInputFocused'
import { useReducedMotion } from '@/hooks/useReducedMotion'
import { VIEW_LABEL_KEYS, VIEW_ROUTES, URL_TO_VIEW, ALL_VIEWS } from '../../viewRoutes'
import type { ViewType } from '@/types'
import { NavExpandedGrid } from './NavExpandedGrid'
import { NavCreateDrawer } from './NavCreateDrawer'
import styles from './FloatingNavPill.module.css'

interface FloatingNavPillProps {
  onToggleSidebar: () => void
  onOpenSearch: () => void
}

const BASE_VIEWS: ViewType[] = ['month', 'week', 'agenda']

const PILL_EASE = [0.65, 0, 0.35, 1] as const
const PILL_TRANSITION = { duration: 0.24, ease: PILL_EASE }
const PILL_TRANSITION_INSTANT = { duration: 0, ease: PILL_EASE }
const CHROME_TRANSITION = { duration: 0.19 }
const CHROME_TRANSITION_INSTANT = { duration: 0 }

export function FloatingNavPill({
  onToggleSidebar,
  onOpenSearch,
}: FloatingNavPillProps): JSX.Element {
  const { t } = useTranslation('calendar')
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
  const reducedMotion = useReducedMotion()

  // framer-motion drives styles from JS, so the global
  // `prefers-reduced-motion` escape hatch in src/index.css (which only zeroes
  // CSS animation/transition durations) does NOT reach these — they have to
  // be zeroed explicitly.
  const pillTransition = reducedMotion ? PILL_TRANSITION_INSTANT : PILL_TRANSITION
  const chromeTransition = reducedMotion ? CHROME_TRANSITION_INSTANT : CHROME_TRANSITION

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

  // `will-change: height` is only worth its memory cost while the pill is
  // actually resizing — this element is mounted for the whole session, so the
  // hint must never be left on permanently. It is switched on by the
  // interaction handlers (expand / create / drag) and switched off again when
  // the height tween settles.
  const [pillAnimating, setPillAnimating] = useState(false)
  const pillAnimatingTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Turning the hint ON is a handler's decision; turning it OFF cannot be,
  // because the settle signal (`animate().then`) only ever arrives if a tween
  // actually starts. An interaction that sets the flag without changing the
  // measured height starts no tween — `collapseAll()` when nothing is open is
  // the reachable case, via the expanded grid's search/settings buttons and
  // the create-drawer items — and framer's `.stop()` does not resolve the
  // promise either. Either path would otherwise strand `will-change: height`
  // on for the rest of the session, which is the exact thing this flag exists
  // to prevent. So every "on" arms a watchdog that guarantees an "off".
  const beginPillAnimation = useCallback(() => {
    setPillAnimating(true)
    if (pillAnimatingTimer.current) clearTimeout(pillAnimatingTimer.current)
    pillAnimatingTimer.current = setTimeout(
      () => {
        pillAnimatingTimer.current = null
        setPillAnimating(false)
      },
      PILL_TRANSITION.duration * 1000 + 120
    )
  }, [])

  // A drag has no bounded duration, so it holds the hint on with no watchdog
  // and relies on the drag-end tween (or the next `beginPillAnimation`) to
  // release it.
  const holdPillAnimation = useCallback(() => {
    setPillAnimating(true)
    if (pillAnimatingTimer.current) {
      clearTimeout(pillAnimatingTimer.current)
      pillAnimatingTimer.current = null
    }
  }, [])

  const endPillAnimation = useCallback(() => {
    if (pillAnimatingTimer.current) {
      clearTimeout(pillAnimatingTimer.current)
      pillAnimatingTimer.current = null
    }
    setPillAnimating(false)
  }, [])

  useEffect(
    () => () => {
      if (pillAnimatingTimer.current) clearTimeout(pillAnimatingTimer.current)
    },
    []
  )

  // CookieConsent is a separate fixed surface. Publish the pill's measured
  // height so that the notice can stack above the expanded sheet as well as
  // the collapsed row, without duplicating the sheet's layout math in CSS.
  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty('--mobile-nav-height', `${Math.max(measuredHeight, 57)}px`)
    return () => {
      root.style.removeProperty('--mobile-nav-height')
    }
  }, [measuredHeight])

  // border-radius is no longer a MotionValue: it is a pure function of state,
  // so a CSS class + `transition: border-radius` gets it off the rAF loop
  // entirely (one fewer JS-driven style write per frame, one fewer animate()
  // per interaction).
  const pillRadiusClass = createDrawerOpen
    ? styles.pillRadiusCreate
    : viewSwitcherExpanded
      ? styles.pillRadiusExpanded
      : ''

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

  // Single source of truth for animating the pill height. Radius is no longer
  // tweened here — it rides a CSS `transition: border-radius` with the exact
  // same duration/easing, driven by the state class, so the two still start
  // and finish in lockstep without a second animate() fighting for frames.
  //
  // The overshoot bug guarded against above ("stretches then snaps back") was
  // caused by two animate(heightMV, ...) calls with different targets racing.
  // That risk is unchanged here: this is still the ONLY place height is
  // tweened, and the layout effect above still lands `measuredHeight` in the
  // same commit as the state change. A CSS transition cannot overshoot — it
  // always interpolates to the current computed value, so re-targeting
  // mid-flight resolves cleanly rather than restarting a spring.
  useEffect(() => {
    measuredHeightRef.current = measuredHeight
    if (isDraggingRef.current) return
    const heightControls = animate(heightMV, measuredHeight, pillTransition)
    void heightControls.then(endPillAnimation)
    return () => {
      heightControls.stop()
    }
    // NB: the cleanup deliberately does NOT clear `pillAnimating`. This effect
    // re-runs on the very commit that starts an interaction (measuredHeight
    // changes), so clearing here would drop `will-change` immediately after a
    // handler set it — i.e. exactly while the tween needs it. Whichever tween
    // ends last resolves it via the `.then` above.
  }, [measuredHeight, heightMV, pillTransition, endPillAnimation])

  const handlePillDragProgress = useCallback(
    (y: number) => {
      heightMV.set(Math.max(collapsedHeightRef.current, measuredHeightRef.current - y))
    },
    [heightMV]
  )

  const handlePillDragActiveChange = useCallback(
    (active: boolean) => {
      isDraggingRef.current = active
      if (active) {
        holdPillAnimation()
      } else {
        beginPillAnimation()
        const controls = animate(heightMV, measuredHeightRef.current, pillTransition)
        void controls.then(endPillAnimation)
      }
    },
    [heightMV, pillTransition, holdPillAnimation, beginPillAnimation, endPillAnimation]
  )

  const collapseAll = useCallback(() => {
    beginPillAnimation()
    setViewSwitcherExpanded(false)
    setQuickSettingsOpen(false)
    setCreateDrawerOpen(false)
  }, [beginPillAnimation])

  const handleToggleSidebarClick = useCallback(() => {
    collapseAll()
    onToggleSidebar()
  }, [collapseAll, onToggleSidebar])

  const handleToggleSwitcher = useCallback(() => {
    beginPillAnimation()
    setCreateDrawerOpen(false)
    setViewSwitcherExpanded((prev) => {
      const next = !prev
      if (!next) setQuickSettingsOpen(false)
      return next
    })
  }, [beginPillAnimation])

  const handleBaseRowDragEnd = useCallback(
    (_event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
      if (info.offset.y < -40 || info.velocity.y < -400) {
        beginPillAnimation()
        setCreateDrawerOpen(false)
        setViewSwitcherExpanded(true)
      }
    },
    [beginPillAnimation]
  )

  const handleToggleCreate = useCallback(() => {
    beginPillAnimation()
    setViewSwitcherExpanded(false)
    setQuickSettingsOpen(false)
    setCreateDrawerOpen((prev) => !prev)
  }, [beginPillAnimation])

  const handleViewChange = useCallback(
    (view: ViewType) => {
      setCurrentView(view)
      navigate(VIEW_ROUTES[view], { replace: true })
      hapticIfEnabled('light')
    },
    [setCurrentView, navigate]
  )

  const activeIndex = BASE_VIEWS.findIndex(
    (view) => currentView === view || (view === 'week' && currentView === '3day')
  )

  // Which column the selector sits in: the matching base view, or the trailing
  // "..." slot on any other route. A single element slides between the two
  // cases, so leaving a base route reads as one continuous move.
  const indicatorIndex = isOnBaseRoute ? (activeIndex >= 0 ? activeIndex : null) : BASE_VIEWS.length

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
        (swipeActiveIndex + (info.offset.x < 0 ? -1 : 1) + swipeViews.length) % swipeViews.length
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
        className={`${styles.pill} ${pillRadiusClass} ${pillAnimating ? styles.pillAnimating : ''} ${textInputFocused ? styles.pillHidden : ''}`}
        style={{ height: heightMV }}
        animate={{ opacity: textInputFocused ? 0 : 1, y: textInputFocused ? 24 : 0 }}
        transition={chromeTransition}
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
            {/* Fixed-width slot: the slot's width is switched by a class (a
                single layout pass on state change) while the button itself
                animates out with transform + opacity only, so the 190ms
                collapse costs zero per-frame layout. */}
            <div
              className={`${styles.chromeSlot} ${styles.chromeSlotHamburger} ${viewSwitcherExpanded ? styles.chromeSlotCollapsed : ''}`}
            >
              <motion.button
                type="button"
                className={styles.hamburgerBtn}
                onClick={handleToggleSidebarClick}
                animate={{
                  scaleX: viewSwitcherExpanded ? 0 : 1,
                  opacity: viewSwitcherExpanded ? 0 : 1,
                }}
                transition={chromeTransition}
                tabIndex={viewSwitcherExpanded ? -1 : undefined}
                aria-hidden={viewSwitcherExpanded || undefined}
                aria-label={
                  isOnSettingsRoute ? t('surface.navBackToCalendar') : t('views.header.toggleMenu')
                }
              >
                {isOnSettingsRoute ? <BackArrowIcon /> : <HamburgerIcon />}
              </motion.button>
            </div>

            <div className={styles.switcherSegment} data-component="nav-pill-switcher">
              {viewSwitcherExpanded ? (
                <NavExpandedGrid
                  quickSettingsOpen={quickSettingsOpen}
                  onToggleQuickSettings={() => {
                    beginPillAnimation()
                    setQuickSettingsOpen((prev) => !prev)
                  }}
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
                  {indicatorIndex !== null && (
                    <div
                      className={styles.switcherActiveBg}
                      style={{ '--switcher-index': indicatorIndex } as CSSProperties}
                    />
                  )}
                  {BASE_VIEWS.map((view, index) => {
                    const isActive =
                      isOnBaseRoute &&
                      (currentView === view || (view === 'week' && currentView === '3day'))
                    return (
                      <button
                        key={view}
                        type="button"
                        className={styles.switcherBtn}
                        style={{ gridColumn: index + 1 }}
                        onClick={() => handleViewChange(view)}
                      >
                        <span
                          className={isActive ? styles.switcherLabelActive : styles.switcherLabel}
                        >
                          {t(VIEW_LABEL_KEYS[view])}
                        </span>
                      </button>
                    )
                  })}
                  <button
                    type="button"
                    className={styles.switcherBtn}
                    style={{ gridColumn: BASE_VIEWS.length + 1 }}
                    onClick={handleToggleSwitcher}
                    aria-label={t('surface.navShowAllViews')}
                    aria-expanded={viewSwitcherExpanded}
                    aria-current={isOnBaseRoute ? undefined : 'page'}
                    data-component="nav-more"
                  >
                    <span
                      className={isOnBaseRoute ? styles.switcherLabel : styles.switcherLabelActive}
                    >
                      <EllipsisIcon />
                    </span>
                  </button>
                </motion.div>
              )}
            </div>

            <div
              className={`${styles.chromeSlot} ${styles.chromeSlotCreate} ${viewSwitcherExpanded ? styles.chromeSlotCollapsed : ''}`}
            >
              <motion.button
                type="button"
                className={styles.createBtn}
                onClick={handleToggleCreate}
                // Uniform `scale`, not `scaleX`: this button is a circle with a
                // plus glyph in it, and squashing only the x-axis reads as a
                // distortion rather than a dismissal.
                animate={{
                  scale: viewSwitcherExpanded ? 0 : 1,
                  opacity: viewSwitcherExpanded ? 0 : 1,
                }}
                transition={chromeTransition}
                tabIndex={viewSwitcherExpanded ? -1 : undefined}
                aria-hidden={viewSwitcherExpanded || undefined}
                aria-label={
                  createDrawerOpen ? t('surface.closeCreateMenu') : t('surface.navCreate')
                }
                aria-expanded={createDrawerOpen}
              >
                <motion.span
                  className={styles.createIcon}
                  animate={{ rotate: createDrawerOpen ? 45 : 0 }}
                  transition={chromeTransition}
                >
                  <PlusIcon />
                </motion.span>
              </motion.button>
            </div>
          </motion.div>
        </div>
      </motion.div>
    </>
  )
}

function EllipsisIcon(): JSX.Element {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <circle cx="4" cy="10" r="1.8" />
      <circle cx="10" cy="10" r="1.8" />
      <circle cx="16" cy="10" r="1.8" />
    </svg>
  )
}

function HamburgerIcon(): JSX.Element {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
      <path d="M3 10H17M3 6H17M3 14H17" />
    </svg>
  )
}

function BackArrowIcon(): JSX.Element {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 4L6 10l6 6" />
    </svg>
  )
}

function PlusIcon(): JSX.Element {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
    >
      <path d="M10 3V17M3 10H17" />
    </svg>
  )
}
