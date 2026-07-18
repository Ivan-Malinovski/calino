import type { JSX } from 'react'
import { useState, useCallback, useRef, useLayoutEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useCalendarStore } from '@/store/calendarStore'
import { hapticIfEnabled } from '@/lib/haptics'
import { VIEW_ROUTES } from '../../viewRoutes'
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

const PILL_TRANSITION = { duration: 0.32, ease: [0.65, 0, 0.35, 1] as const }
const CHROME_TRANSITION = { duration: 0.25 }
const INDICATOR_TRANSITION = { type: 'spring', stiffness: 500, damping: 40 } as const

export function FloatingNavPill({ onToggleSidebar, onOpenSearch }: FloatingNavPillProps): JSX.Element {
  const navigate = useNavigate()
  const currentView = useCalendarStore((state) => state.currentView)
  const setCurrentView = useCalendarStore((state) => state.setCurrentView)

  const [viewSwitcherExpanded, setViewSwitcherExpanded] = useState(false)
  const [quickSettingsOpen, setQuickSettingsOpen] = useState(false)
  const [createDrawerOpen, setCreateDrawerOpen] = useState(false)

  const contentRef = useRef<HTMLDivElement>(null)
  const [measuredHeight, setMeasuredHeight] = useState<number>(0)

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

  const pillRadius = createDrawerOpen ? 26 : viewSwitcherExpanded ? 30 : 34

  return (
    <>
      {viewSwitcherExpanded && (
        <div className={styles.tapCatcher} onClick={collapseAll} aria-hidden="true" />
      )}
      <motion.div
        className={styles.pill}
        animate={{ height: measuredHeight, borderRadius: pillRadius }}
        transition={PILL_TRANSITION}
        data-component="floating-nav-pill"
      >
        <div ref={contentRef} className={styles.pillContent}>
          {createDrawerOpen && <NavCreateDrawer onClose={() => setCreateDrawerOpen(false)} />}

          <div
            className={
              viewSwitcherExpanded ? `${styles.baseRow} ${styles.baseRowExpanded}` : styles.baseRow
            }
          >
            <motion.button
              type="button"
              className={styles.hamburgerBtn}
              onClick={handleToggleSidebarClick}
              animate={{ width: viewSwitcherExpanded ? 0 : 44, opacity: viewSwitcherExpanded ? 0 : 1 }}
              transition={CHROME_TRANSITION}
              aria-label="Toggle sidebar"
            >
              <HamburgerIcon />
            </motion.button>

            <div className={styles.switcherSegment} data-component="nav-pill-switcher">
              {viewSwitcherExpanded ? (
                <NavExpandedGrid
                  quickSettingsOpen={quickSettingsOpen}
                  onToggleQuickSettings={() => setQuickSettingsOpen((prev) => !prev)}
                  onOpenSearch={onOpenSearch}
                  onCollapse={collapseAll}
                />
              ) : (
                <div className={styles.switcherTrack}>
                  {activeIndex >= 0 && (
                    <motion.div
                      layoutId="nav-active-indicator"
                      className={styles.switcherActiveBg}
                      style={{ gridColumn: activeIndex + 1, gridRow: 1 }}
                      transition={INDICATOR_TRANSITION}
                    />
                  )}
                  {BASE_VIEWS.map((view, index) => {
                    const isActive =
                      currentView === view.value || (view.value === 'week' && currentView === '3day')
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
                    <span className={styles.switcherLabel}>
                      <EllipsisIcon />
                    </span>
                  </button>
                </div>
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
          </div>
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
