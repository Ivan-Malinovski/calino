import type { JSX } from 'react'
import React, { useState, useCallback, useEffect, useRef, useLayoutEffect } from 'react'
import {
  format,
  addMonths,
  addWeeks,
  addDays,
  parseISO,
  startOfWeek,
  endOfWeek,
  subMonths,
  subWeeks,
  subDays,
  addYears,
  subYears,
} from 'date-fns'
import { useNavigate } from 'react-router-dom'
import { useCalendarStore } from '@/store/calendarStore'
import { useSettingsStore } from '@/store/settingsStore'
import { QuickSettingsPanel } from './QuickSettingsPanel'
import { useGestures } from '@/hooks/useGestures'
import { useAnimatedClose } from '@/hooks/useAnimatedClose'
import type { ViewType } from '@/types'
import styles from './CalendarHeader.module.css'

interface CalendarHeaderProps {
  onToggleSidebar?: () => void
  onOpenCommandPalette?: () => void
}

const VIEWS: { value: ViewType; label: string }[] = [
  { value: 'month', label: 'Month' },
  { value: 'year', label: 'Year' },
  { value: 'week', label: 'Week' },
  { value: 'day', label: 'Day' },
  { value: 'agenda', label: 'Agenda' },
  { value: 'todo', label: 'Tasks' },
  { value: 'journal', label: 'Journal' },
  { value: 'contacts', label: 'Contacts' },
]

const VIEW_ROUTES: Record<ViewType, string> = {
  month: '/month',
  year: '/year',
  week: '/week',
  '3day': '/3day',
  day: '/day',
  agenda: '/agenda',
  todo: '/tasks',
  journal: '/journal',
  contacts: '/contacts',
}

export function CalendarHeader({
  onToggleSidebar,
  onOpenCommandPalette,
}: CalendarHeaderProps): JSX.Element {
  const navigate = useNavigate()
  const currentDate = useCalendarStore((state) => state.currentDate)
  const currentView = useCalendarStore((state) => state.currentView)
  const setCurrentDate = useCalendarStore((state) => state.setCurrentDate)
  const setCurrentView = useCalendarStore((state) => state.setCurrentView)
  const firstDayOfWeek = useSettingsStore((state) => state.firstDayOfWeek)
  const journalEnabled = useSettingsStore((state) => state.journalEnabled)
  const contactsEnabled = useSettingsStore((state) => state.contactsEnabled)
  const sidebarWidth = useSettingsStore((state) => state.sidebarWidth)
  const sidebarCollapsed = useSettingsStore((state) => state.sidebarCollapsed)
  const agendaSidebarOpen = useSettingsStore((state) => state.agendaSidebarOpen)
  const updateSettings = useSettingsStore((state) => state.updateSettings)

  // Hover sub-menus attached to individual view tabs (Week → 3-day,
  // Agenda → Sidebar). Only one is open at a time.
  const [openTabMenu, setOpenTabMenu] = useState<ViewType | null>(null)
  // Fixed viewport position for the open sub-menu. The tab strip has
  // `overflow: hidden`, so the menu is positioned fixed to escape the clip
  // while remaining a DOM child of its wrapper (keeps hover intact).
  const [tabMenuPos, setTabMenuPos] = useState<{ left: number; top: number } | null>(null)
  const tabMenuCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Retains which tab's menu is showing so it stays mounted through its exit
  // animation after `openTabMenu` flips back to null.
  const [lastTabMenuView, setLastTabMenuView] = useState<ViewType | null>(null)
  const openTabMenuFor = useCallback((view: ViewType, anchor: HTMLElement) => {
    if ('ontouchstart' in window) return
    if (tabMenuCloseTimer.current) {
      clearTimeout(tabMenuCloseTimer.current)
      tabMenuCloseTimer.current = null
    }
    const rect = anchor.getBoundingClientRect()
    setTabMenuPos({ left: rect.left, top: rect.bottom + 4 })
    setLastTabMenuView(view)
    setOpenTabMenu(view)
  }, [])
  const scheduleTabMenuClose = useCallback(() => {
    if ('ontouchstart' in window) return
    tabMenuCloseTimer.current = setTimeout(() => {
      setOpenTabMenu(null)
      tabMenuCloseTimer.current = null
    }, 150)
  }, [])

  const [isViewDropdownOpen, setIsViewDropdownOpen] = useState(false)
  const viewDropdownRef = useRef<HTMLDivElement>(null)
  const viewDropdownCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [indicatorStyle, setIndicatorStyle] = useState<{ left: number; width: number }>({ left: 0, width: 0 })
  const viewTabsRef = useRef<HTMLDivElement>(null)
  const viewTabRefs = useRef<Map<string, HTMLButtonElement>>(new Map())

  // Sliding indicator for view tabs. Measured from the active tab's box —
  // re-measured whenever the view changes, the container resizes, or web fonts
  // finish loading (fonts change tab widths after first paint, which otherwise
  // leaves the indicator misaligned until the next view switch).
  // The 3-day view lives under the Week tab, so the indicator tracks the Week
  // tab while in it.
  const indicatorView: ViewType = currentView === '3day' ? 'week' : currentView
  // Last-measured geometry, so redundant re-measures don't re-render.
  const lastIndicator = useRef<{ left: number; width: number }>({ left: 0, width: 0 })
  const measureIndicator = useCallback(() => {
    const container = viewTabsRef.current
    const activeTab = viewTabRefs.current.get(indicatorView)
    if (container && activeTab && activeTab.offsetWidth > 0) {
      // offsetLeft/offsetWidth (layout box) rather than getBoundingClientRect:
      // rects reflect in-progress CSS transforms/transitions (the .viewTabs
      // max-width transition, :active scale) during a cold load, which made
      // the indicator intermittently mis-sized. The .viewTabItem wrappers are
      // unpositioned, so the tab's offsetParent stays .viewTabs.
      const next = { left: activeTab.offsetLeft, width: activeTab.offsetWidth }
      const prev = lastIndicator.current
      if (next.left !== prev.left || next.width !== prev.width) {
        lastIndicator.current = next
        setIndicatorStyle(next)
      }
    }
  }, [indicatorView])

  useLayoutEffect(() => {
    measureIndicator()

    const container = viewTabsRef.current
    if (!container) return

    // On a cold load the tab strip is still settling when the synchronous pass
    // runs — most importantly, the web font hasn't swapped in yet, so the tabs
    // are measured at their (wider) fallback-font width, leaving the indicator
    // too wide. `document.fonts.ready` resolves *before* the swapped font is
    // laid out, so every font-driven re-measure is deferred one frame. We also
    // fire a short cascade of delayed re-measures as a safety net for slow
    // layout/paint on first load.
    const rafs: number[] = []
    const timers: ReturnType<typeof setTimeout>[] = []
    const remeasureNextFrame = (): void => {
      rafs.push(requestAnimationFrame(() => rafs.push(requestAnimationFrame(measureIndicator))))
    }
    remeasureNextFrame()
    for (const delay of [80, 200, 400, 800]) {
      timers.push(setTimeout(measureIndicator, delay))
    }

    // Observe both the container and each tab: a font swap can resize a tab
    // without changing the container's box.
    const observer = new ResizeObserver(() => measureIndicator())
    observer.observe(container)
    viewTabRefs.current.forEach((tab) => observer.observe(tab))

    let cancelled = false
    if (typeof document !== 'undefined' && document.fonts?.ready) {
      document.fonts.ready.then(() => {
        if (!cancelled) remeasureNextFrame()
      })
    }
    window.addEventListener('load', measureIndicator)

    return () => {
      cancelled = true
      rafs.forEach(cancelAnimationFrame)
      timers.forEach(clearTimeout)
      observer.disconnect()
      window.removeEventListener('load', measureIndicator)
    }
  }, [measureIndicator])

  const [showQuickSettings, setShowQuickSettings] = useState(false)
  const quickSettingsTimeoutRef = useState(() => ({ current: undefined as ReturnType<typeof setTimeout> | undefined }))[0]

  // Animate the dropdowns out when their boolean flips false (close-on-select,
  // click-outside, hover-leave all funnel through the same exit animation).
  const noop = useCallback(() => {}, [])
  const viewDropdown = useAnimatedClose(isViewDropdownOpen, noop, 130)
  const quickSettings = useAnimatedClose(showQuickSettings, noop, 80)
  // Hover tab-menus (Week→3-day, Agenda→Sidebar) share one exit animation; the
  // last-shown view is retained so it can keep rendering while closing.
  const tabMenu = useAnimatedClose(openTabMenu !== null, noop, 80)

  useEffect(() => {
    if (!isViewDropdownOpen) return
    const handleClickOutside = (e: MouseEvent): void => {
      if (viewDropdownRef.current && !viewDropdownRef.current.contains(e.target as Node)) {
        setIsViewDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isViewDropdownOpen])

  const date = parseISO(currentDate)
  const year = format(date, 'yyyy')

  const getTitle = (): { month: string; year: string } | string => {
    switch (currentView) {
      case 'month':
        return { month: format(date, 'MMMM'), year }
      case 'year':
        return year
      case 'week': {
        const weekStart = startOfWeek(date, { weekStartsOn: firstDayOfWeek })
        const weekEnd = endOfWeek(date, { weekStartsOn: firstDayOfWeek })
        if (format(weekStart, 'MMM') === format(weekEnd, 'MMM')) {
          return `${format(weekStart, 'MMM d')} – ${format(weekEnd, 'd')}`
        }
        return `${format(weekStart, 'MMM d')} – ${format(weekEnd, 'MMM d')}`
      }
      case '3day': {
        const end = addDays(date, 2)
        if (format(date, 'MMM') === format(end, 'MMM')) {
          return `${format(date, 'MMM d')} – ${format(end, 'd')}`
        }
        return `${format(date, 'MMM d')} – ${format(end, 'MMM d')}`
      }
      case 'day':
        return format(date, 'EEE, MMMM d')
      case 'agenda':
        return format(date, 'MMMM')
      case 'todo':
        return 'Tasks'
      case 'contacts':
        return 'Contacts'
      default:
        return format(date, 'MMMM')
    }
  }

  const title = getTitle()

  const handleNavigate = (direction: 'prev' | 'next'): void => {
    let newDate: Date
    switch (currentView) {
      case 'month':
        newDate = direction === 'prev' ? subMonths(date, 1) : addMonths(date, 1)
        break
      case 'year':
        newDate = direction === 'prev' ? subYears(date, 1) : addYears(date, 1)
        break
      case 'week':
        newDate = direction === 'prev' ? subWeeks(date, 1) : addWeeks(date, 1)
        break
      case '3day':
        newDate = direction === 'prev' ? subDays(date, 3) : addDays(date, 3)
        break
      case 'day':
        newDate = direction === 'prev' ? subDays(date, 1) : addDays(date, 1)
        break
      case 'agenda':
        newDate = direction === 'prev' ? subMonths(date, 1) : addMonths(date, 1)
        break
      case 'todo':
        newDate = date
        break
      case 'journal':
        newDate = direction === 'prev' ? subMonths(date, 1) : addMonths(date, 1)
        break
      case 'contacts':
        newDate = date
        break
      default:
        newDate = date
    }
    setCurrentDate(format(newDate, 'yyyy-MM-dd'))
  }

  const handleToday = (): void => {
    setCurrentDate(format(new Date(), 'yyyy-MM-dd'))
  }

  // Clicking the header title takes you back to month view from anywhere else;
  // if you're already in month view it keeps the "jump to today" shortcut.
  const handleTitleClick = (): void => {
    if (currentView === 'month') {
      handleToday()
    } else {
      handleViewChange('month')
    }
  }

  const handleViewChange = useCallback(
    (view: ViewType) => {
      setCurrentView(view)
      navigate(VIEW_ROUTES[view], { replace: true })
    },
    [setCurrentView, navigate]
  )

  // Per-tab hover sub-menu items. Absent entries render as a plain tab.
  const tabMenus: Partial<Record<ViewType, { label: string; onClick: () => void }[]>> = {
    week: [{ label: '3-day', onClick: () => handleViewChange('3day') }],
    agenda: [
      {
        label: agendaSidebarOpen ? 'Hide sidebar' : 'Sidebar',
        onClick: () => updateSettings({ agendaSidebarOpen: !agendaSidebarOpen }),
      },
    ],
  }

  const handleSwipe = useCallback(
    (direction: 'left' | 'right' | 'up' | 'down') => {
      const dir = direction === 'left' ? 'next' : direction === 'right' ? 'prev' : null
      if (!dir) return

      let newDate: Date
      switch (currentView) {
        case 'month':
          newDate = dir === 'prev' ? subMonths(date, 1) : addMonths(date, 1)
          break
        case 'year':
          newDate = dir === 'prev' ? subYears(date, 1) : addYears(date, 1)
          break
        case 'week':
          newDate = dir === 'prev' ? subWeeks(date, 1) : addWeeks(date, 1)
          break
        case '3day':
          newDate = dir === 'prev' ? subDays(date, 3) : addDays(date, 3)
          break
        case 'day':
          newDate = dir === 'prev' ? subDays(date, 1) : addDays(date, 1)
          break
        case 'agenda':
          newDate = dir === 'prev' ? subMonths(date, 1) : addMonths(date, 1)
          break
        case 'todo':
          newDate = date
          break
        default:
          newDate = date
      }
      setCurrentDate(format(newDate, 'yyyy-MM-dd'))
    },
    [currentView, date, setCurrentDate]
  )

  const { bind } = useGestures({
    onSwipe: handleSwipe,
    swipeThreshold: 50,
  })

  // Calculate brand column width based on sidebar state
  const brandColumnWidth = sidebarCollapsed ? 'var(--sidebar-collapsed-width, 40px)' : `${sidebarWidth}px`

  return (
    <header
      className={styles.header}
      style={{ '--header-brand-col': brandColumnWidth } as React.CSSProperties}
      data-sidebar-collapsed={sidebarCollapsed || undefined}
      {...bind}
      data-component="header"
    >
      {/* Brand — hidden by CSS when sidebar collapsed or at compact breakpoint */}
      <div className={styles.brand}>
        <div className={styles.brandDiamond} />
        <span className={styles.brandName}>Calino</span>
      </div>
      {/* Hamburger — shown by CSS when sidebar collapsed or at compact breakpoint */}
      <button
        className={styles.hamburger}
        onClick={onToggleSidebar}
        aria-label="Toggle menu"
      >
        <HamburgerIcon />
      </button>

      {/* Navigator - prev/today/next */}
      <div
        className={`${styles.navigator} ${currentView === 'todo' || currentView === 'contacts' ? styles.navigatorHidden : ''}`}
        aria-hidden={currentView === 'todo' || currentView === 'contacts'}
      >
        <button
          className={styles.navArrow}
          onClick={() => handleNavigate('prev')}
          aria-label="Previous"
        >
          <ChevronLeft />
        </button>
        <button className={styles.navToday} onClick={handleToday} data-component="today-button">
          Today
        </button>
        <button
          className={styles.navArrow}
          onClick={() => handleNavigate('next')}
          aria-label="Next"
        >
          <ChevronRight />
        </button>
      </div>

      {/* Title — click returns to month view from anywhere (jumps to today when
          already in month) */}
      <div
        className={styles.titleGroup}
        onClick={handleTitleClick}
        role="button"
        tabIndex={0}
        aria-label={currentView === 'month' ? 'Go to today' : 'Go to month view'}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            handleTitleClick()
          }
        }}
      >
        {typeof title === 'object' ? (
          <>
            <h1 className={styles.monthTitle}>{title.month}</h1>
            <span className={styles.yearTitle}>{title.year}</span>
          </>
        ) : (
          <h1 className={styles.viewTitle}>{title}</h1>
        )}
      </div>

      {/* Spacer */}
      <div className={styles.spacer} />

      {/* Right cluster */}
      <div className={styles.rightCluster}>
        {/* Search - CSS handles hiding at compact mobile */}
        <button
          className={styles.iconButton}
          onClick={onOpenCommandPalette}
          aria-label="Search or commands"
        >
          <SearchIcon />
        </button>

        {/* View Tabs - CSS handles visibility at breakpoints */}
        <div className={styles.viewTabs} ref={viewTabsRef} data-component="view-switcher">
          <div
            className={styles.viewTabIndicator}
            style={{ left: indicatorStyle.left, width: indicatorStyle.width }}
            data-component="view-switcher-indicator"
          />
          {VIEWS.filter(v => (journalEnabled || v.value !== 'journal') && (contactsEnabled || v.value !== 'contacts')).map((view, index) => {
            const isActive =
              currentView === view.value || (view.value === 'week' && currentView === '3day')
            const menu = tabMenus[view.value]
            const tabButton = (
              <button
                ref={(el) => {
                  if (el) viewTabRefs.current.set(view.value, el)
                  else viewTabRefs.current.delete(view.value)
                }}
                className={`${styles.viewTab} ${isActive ? styles.viewTabActive : ''}`}
                onClick={() => handleViewChange(view.value)}
              >
                {view.label}
              </button>
            )
            return (
              <React.Fragment key={view.value}>
                {index === 4 && <div className={styles.viewTabDivider} />}
                {menu ? (
                  <div
                    className={styles.viewTabItem}
                    onMouseEnter={(e) => openTabMenuFor(view.value, e.currentTarget)}
                    onMouseLeave={scheduleTabMenuClose}
                  >
                    {tabButton}
                    {(openTabMenu === view.value ||
                      (tabMenu.closing && lastTabMenuView === view.value)) &&
                      tabMenuPos && (
                      <div
                        className={`${styles.viewTabMenu} ${tabMenu.closing ? styles.viewTabMenuClosing : ''}`}
                        role="menu"
                        style={{ left: tabMenuPos.left, top: tabMenuPos.top }}
                      >
                        {menu.map((item) => (
                          <button
                            key={item.label}
                            className={styles.viewTabMenuItem}
                            role="menuitem"
                            onClick={() => {
                              item.onClick()
                              setOpenTabMenu(null)
                            }}
                          >
                            {item.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  tabButton
                )}
              </React.Fragment>
            )
          })}
        </div>
        {/* View Dropdown - CSS handles visibility at tablet breakpoint */}
        <div
          className={styles.viewDropdown}
          ref={viewDropdownRef}
          onMouseEnter={() => {
            // Skip on touch devices — click handles toggle
            if ('ontouchstart' in window) return
            if (viewDropdownCloseTimer.current) {
              clearTimeout(viewDropdownCloseTimer.current)
              viewDropdownCloseTimer.current = null
            }
            setIsViewDropdownOpen(true)
          }}
          onMouseLeave={() => {
            if ('ontouchstart' in window) return
            viewDropdownCloseTimer.current = setTimeout(() => {
              setIsViewDropdownOpen(false)
              viewDropdownCloseTimer.current = null
            }, 150)
          }}
        >
          <button
            className={styles.viewDropdownButton}
            onClick={() => setIsViewDropdownOpen((prev) => !prev)}
            aria-haspopup="menu"
            aria-expanded={isViewDropdownOpen}
            aria-controls="view-dropdown-menu"
            data-component="view-dropdown-trigger"
          >
            {VIEWS.find((v) => v.value === currentView)?.label}
            <svg aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" fill="none" className={`${styles.viewDropdownArrow} ${isViewDropdownOpen ? styles.viewDropdownArrowOpen : ''}`}>
              <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          {viewDropdown.rendered && (
            <div
              className={`${styles.viewDropdownMenu} ${viewDropdown.closing ? styles.viewDropdownClosing : ''}`}
              role="menu"
              id="view-dropdown-menu"
              data-component="view-dropdown-menu"
              onKeyDown={(e) => {
                // WAI-ARIA menu keyboard pattern: arrow keys move focus
                // between items, Home/End jump to first/last, Escape closes
                // and returns focus to the trigger.
                if (e.key === 'Escape') {
                  e.preventDefault()
                  setIsViewDropdownOpen(false)
                  viewDropdownRef.current?.querySelector<HTMLButtonElement>(
                    'button[aria-haspopup="menu"]'
                  )?.focus()
                  return
                }
                const items = Array.from(
                  viewDropdownRef.current?.querySelectorAll<HTMLButtonElement>(
                    '[role="menuitem"]'
                  ) ?? []
                )
                if (items.length === 0) return
                const currentIndex = items.findIndex((el) => el === document.activeElement)
                let nextIndex: number
                if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % items.length
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault()
                  nextIndex = currentIndex < 0 ? items.length - 1 : (currentIndex - 1 + items.length) % items.length
                } else if (e.key === 'Home') {
                  e.preventDefault()
                  nextIndex = 0
                } else if (e.key === 'End') {
                  e.preventDefault()
                  nextIndex = items.length - 1
                } else {
                  return
                }
                items[nextIndex]?.focus()
              }}
            >
              {VIEWS.filter(v => (journalEnabled || v.value !== 'journal') && (contactsEnabled || v.value !== 'contacts')).map((view, index) => (
                <React.Fragment key={view.value}>
                  {index === 4 && <div className={styles.viewDropdownDivider} role="separator" />}
                  <button
                    className={`${styles.viewDropdownItem} ${currentView === view.value ? styles.viewDropdownItemActive : ''}`}
                    onClick={() => {
                      handleViewChange(view.value)
                      setIsViewDropdownOpen(false)
                    }}
                    role="menuitem"
                    tabIndex={isViewDropdownOpen ? 0 : -1}
                  >
                    {view.label}
                  </button>
                </React.Fragment>
              ))}
            </div>
          )}
        </div>

        {/* Settings - CSS handles hiding at compact mobile */}
        <div
          className={styles.settingsWrapper}
          onMouseEnter={() => {
            clearTimeout(quickSettingsTimeoutRef.current)
            setShowQuickSettings(true)
          }}
          onMouseLeave={() => {
            quickSettingsTimeoutRef.current = setTimeout(() => setShowQuickSettings(false), 200)
          }}
        >
          <button
            className={styles.iconButton}
            onClick={() => navigate('/settings')}
            aria-label="Settings"
          >
            <SettingsIcon />
          </button>
            {quickSettings.rendered && (
            <div className={`${styles.quickSettingsDropdown} ${quickSettings.closing ? styles.quickSettingsClosing : ''}`}>
              <QuickSettingsPanel />
            </div>
          )}
        </div>
      </div>
    </header>
  )
}

function ChevronLeft(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 12L6 8L10 4" />
    </svg>
  )
}

function ChevronRight(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 4L10 8L6 12" />
    </svg>
  )
}

function HamburgerIcon(): JSX.Element {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M3 10H17M3 6H17M3 14H17" />
    </svg>
  )
}

function SearchIcon(): JSX.Element {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21L16.65 16.65" />
    </svg>
  )
}

function SettingsIcon(): JSX.Element {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  )
}
