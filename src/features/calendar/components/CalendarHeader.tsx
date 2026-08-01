import type { JSX } from 'react'
import React, { useState, useCallback, useEffect, useRef, useLayoutEffect } from 'react'
import { format, parseISO, startOfWeek, endOfWeek, addDays, isToday } from 'date-fns'
import { AnimatePresence, motion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { useCalendarStore } from '@/store/calendarStore'
import { useSettingsStore } from '@/store/settingsStore'
import { QuickSettingsPanel } from './QuickSettingsPanel'
import { ChevronLeft, ChevronRight } from '@/components/common/icons'
import { useGestures } from '@/hooks/useGestures'
import { useAnimatedClose } from '@/hooks/useAnimatedClose'
import { useReducedMotion } from '@/hooks/useReducedMotion'
import { DUR_FAST, EASE_POP } from '@/lib/motion'
import { VIEW_ROUTES, ALL_VIEWS } from '../viewRoutes'
import { useVisibleViews, useSwitcherItems, useReorderSwitcher } from '../useOrderedViews'
import { useTabReorder } from './useTabReorder'
import { getNavigatedDate } from '../dateNavigation'
import type { ViewType } from '@/types'
import styles from './CalendarHeader.module.css'

interface CalendarHeaderProps {
  onToggleSidebar?: () => void
  onOpenCommandPalette?: () => void
}

export function CalendarHeader({
  onToggleSidebar,
  onOpenCommandPalette,
}: CalendarHeaderProps): JSX.Element {
  const navigate = useNavigate()
  const prefersReducedMotion = useReducedMotion()
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
  const [indicatorStyle, setIndicatorStyle] = useState<{ left: number; width: number }>({
    left: 0,
    width: 0,
  })
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

  // Dynamic tabs↔dropdown switch: whether the full view-tab strip fits in
  // the available header space, measured directly rather than assumed from a
  // fixed viewport breakpoint (the tab list itself varies with which
  // features are enabled, so a hardcoded width would be wrong as soon as a
  // feature toggle changes how many tabs there are). Defaults to the
  // dropdown (safest/most compact) until the first measurement lands.
  const headerRef = useRef<HTMLElement>(null)
  const [useDropdownSwitcher, setUseDropdownSwitcher] = useState(true)
  const lastSwitcherMode = useRef(true)

  const evaluateSwitcherMode = useCallback(() => {
    const header = headerRef.current
    const tabsEl = viewTabsRef.current
    const dropdownEl = viewDropdownRef.current
    if (!header || !tabsEl || !dropdownEl) return

    // CSS Grid's `auto` tracks (navigator, title, rightCluster) don't hold a
    // fixed "natural" width under pressure — they can compress non-linearly
    // as space tightens, so there's no reliable algebraic way to derive
    // "how much room the tab strip would need" from the current layout.
    // Instead, ask the browser directly: force the tab strip into its
    // expanded state and the dropdown into its collapsed state, synchronously,
    // and check whether the header overflows. That's the exact question we
    // care about, answered by the real grid algorithm — then immediately
    // restore, before this ever paints, so there's no visible flash.
    //
    // The collapse/expand transition has to be suspended for this: reading
    // layout right after toggling the classes would otherwise catch the
    // animation's very first frame (≈ the old value) rather than the
    // settled target.
    const tabsWasCollapsed = tabsEl.classList.contains(styles.viewTabsCollapsed)
    const dropdownWasCollapsed = dropdownEl.classList.contains(styles.viewDropdownCollapsed)

    tabsEl.classList.add(styles.switcherNoAnimate)
    dropdownEl.classList.add(styles.switcherNoAnimate)

    tabsEl.classList.remove(styles.viewTabsCollapsed)
    dropdownEl.classList.add(styles.viewDropdownCollapsed)
    // Tiny tolerance for sub-pixel rounding — not a safety margin against
    // real overflow (an exact tie, scrollWidth === clientWidth, is a fit).
    // The navigator/title grid columns are pinned to their content size (see
    // .header), so any transient overflow during the reactive measure→decide
    // gap lands on the switcher itself rather than squeezing them.
    const fits = header.scrollWidth <= header.clientWidth + 2

    if (tabsWasCollapsed) tabsEl.classList.add(styles.viewTabsCollapsed)
    else tabsEl.classList.remove(styles.viewTabsCollapsed)
    if (dropdownWasCollapsed) dropdownEl.classList.add(styles.viewDropdownCollapsed)
    else dropdownEl.classList.remove(styles.viewDropdownCollapsed)

    // Flush the restored, still-untransitioned layout before re-enabling
    // transitions, so the *next* real toggle (driven by React state) animates
    // instead of jumping straight to its target.
    void header.offsetWidth
    tabsEl.classList.remove(styles.switcherNoAnimate)
    dropdownEl.classList.remove(styles.switcherNoAnimate)

    const desiredDropdown = !fits
    if (desiredDropdown !== lastSwitcherMode.current) {
      lastSwitcherMode.current = desiredDropdown
      setUseDropdownSwitcher(desiredDropdown)
    }
  }, [])

  useLayoutEffect(() => {
    evaluateSwitcherMode()

    const header = headerRef.current
    if (!header) return

    const rafs: number[] = []
    const timers: ReturnType<typeof setTimeout>[] = []
    const remeasureNextFrame = (): void => {
      rafs.push(requestAnimationFrame(() => rafs.push(requestAnimationFrame(evaluateSwitcherMode))))
    }
    remeasureNextFrame()
    for (const delay of [80, 200, 400, 800]) {
      timers.push(setTimeout(evaluateSwitcherMode, delay))
    }

    const observer = new ResizeObserver(() => evaluateSwitcherMode())
    observer.observe(header)

    let cancelled = false
    if (typeof document !== 'undefined' && document.fonts?.ready) {
      document.fonts.ready.then(() => {
        if (!cancelled) remeasureNextFrame()
      })
    }
    window.addEventListener('resize', evaluateSwitcherMode)

    return () => {
      cancelled = true
      rafs.forEach(cancelAnimationFrame)
      timers.forEach(clearTimeout)
      observer.disconnect()
      window.removeEventListener('resize', evaluateSwitcherMode)
    }
  }, [evaluateSwitcherMode])

  // Re-measure whenever something that changes the required width happens
  // outside of a header resize: the view list (journal/contacts toggles), the
  // active view (dropdown label / title length), or sidebar geometry.
  useLayoutEffect(() => {
    evaluateSwitcherMode()
  }, [
    evaluateSwitcherMode,
    journalEnabled,
    contactsEnabled,
    currentView,
    currentDate,
    sidebarWidth,
    sidebarCollapsed,
  ])

  const [showQuickSettings, setShowQuickSettings] = useState(false)
  const quickSettingsTimeoutRef = useState(() => ({
    current: undefined as ReturnType<typeof setTimeout> | undefined,
  }))[0]

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

  // Directional title transition: the label slides in from the side you're
  // heading towards (forward → in from the right), so a month jump reads as
  // movement along the calendar rather than a silent text swap. Keyed off the
  // rendered label, not the date, so same-label navigation (a day step inside
  // the current month, or "Today" when already there) stays still.
  const titleLabel = typeof title === 'object' ? `${title.month} ${title.year}` : title
  const prevTitleRef = useRef(titleLabel)
  const prevDateRef = useRef(currentDate)
  const [titleTransition, setTitleTransition] = useState<{
    dir: 'next' | 'prev'
    seq: number
  } | null>(null)

  useLayoutEffect(() => {
    if (prevTitleRef.current === titleLabel) {
      prevDateRef.current = currentDate
      return
    }
    const forward = currentDate > prevDateRef.current
    prevTitleRef.current = titleLabel
    prevDateRef.current = currentDate
    setTitleTransition((prev) => ({ dir: forward ? 'next' : 'prev', seq: (prev?.seq ?? 0) + 1 }))
  }, [titleLabel, currentDate])

  // Remounting on `seq` is what replays the CSS animation; the class picks the
  // direction. Reduced motion is handled in the stylesheet.
  const titleAnimClass = titleTransition
    ? titleTransition.dir === 'next'
      ? styles.titleEnterNext
      : styles.titleEnterPrev
    : ''
  const titleAnimKey = titleTransition?.seq ?? 0

  const visibleViews = useVisibleViews()
  const switcherItems = useSwitcherItems()
  const reorderSwitcher = useReorderSwitcher()

  // Screen-reader feedback for keyboard reordering, which has no visual
  // "picked up / dropped" cue of its own.
  const [reorderAnnouncement, setReorderAnnouncement] = useState('')
  const tabReorder = useTabReorder(
    switcherItems,
    viewTabRefs,
    reorderSwitcher,
    // Reordering by drag only makes sense while the tabs are actually
    // rendered; in dropdown mode the strip is collapsed.
    !useDropdownSwitcher,
    setReorderAnnouncement
  )
  const activeTabIndex = visibleViews.findIndex(
    (v) => currentView === v.value || (v.value === 'week' && currentView === '3day')
  )

  // Reordering moves tabs without resizing them, so the ResizeObserver above
  // never fires — but every tab's offsetLeft has changed, which is exactly
  // what the indicator is positioned from. Re-measure whenever the order does.
  const viewOrderKey = visibleViews.map((v) => v.value).join(',')
  useLayoutEffect(() => {
    measureIndicator()
  }, [viewOrderKey, measureIndicator])

  const handleNavigate = (direction: 'prev' | 'next'): void => {
    const newDate = getNavigatedDate(currentView, date, direction)
    setCurrentDate(format(newDate, 'yyyy-MM-dd'))
  }

  const handleToday = (): void => {
    setCurrentDate(format(new Date(), 'yyyy-MM-dd'))
    window.dispatchEvent(new CustomEvent('calino:jumpToToday'))
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

      const newDate = getNavigatedDate(currentView, date, dir)
      setCurrentDate(format(newDate, 'yyyy-MM-dd'))
    },
    [currentView, date, setCurrentDate]
  )

  const { bind } = useGestures({
    onSwipe: handleSwipe,
    swipeThreshold: 50,
  })

  // Calculate brand column width based on sidebar state
  const brandColumnWidth = sidebarCollapsed
    ? 'var(--sidebar-collapsed-width, 40px)'
    : `${sidebarWidth}px`

  return (
    <header
      ref={headerRef}
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
      <button className={styles.hamburger} onClick={onToggleSidebar} aria-label="Toggle menu">
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
            <h1 key={`m${titleAnimKey}`} className={`${styles.monthTitle} ${titleAnimClass}`}>
              {title.month}
            </h1>
            <span key={`y${titleAnimKey}`} className={`${styles.yearTitle} ${titleAnimClass}`}>
              {title.year}
            </span>
          </>
        ) : (
          <h1 key={`v${titleAnimKey}`} className={`${styles.viewTitle} ${titleAnimClass}`}>
            {title}
          </h1>
        )}
      </div>

      {/* Spacer. Also hosts the task filter — see #task-header-slot below. */}
      <div className={styles.spacer}>
        {/* Portal target for TodoView's project filter — rendered here so it
            sits on the same line as the "Tasks" title instead of TodoView's
            own sub-bar, where it used to crowd the Add button.

            It lives in the spacer, not the right cluster, on purpose. The
            cluster is right-anchored, so anything added to it widens it
            leftwards and drags the view switcher along — the switcher visibly
            jumped left on entering Tasks. The spacer absorbs the width
            instead, leaving the switcher fixed. */}
        {currentView === 'todo' && <div id="task-header-slot" className={styles.taskHeaderSlot} />}
      </div>

      {/* Right cluster */}
      <div className={styles.rightCluster}>
        {/* Go to today - only shown when not already on today, so the title's
            own jump-to-today click gets a discoverable, visible counterpart */}
        <AnimatePresence initial={false}>
          {!isToday(date) && (
            <motion.button
              className={`${styles.iconButton} ${styles.todayButton}`}
              onClick={handleToday}
              aria-label="Go to today"
              data-component="today-button-icon"
              initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.6 }}
              transition={{ duration: prefersReducedMotion ? 0 : DUR_FAST, ease: EASE_POP }}
            >
              <TodayIcon />
            </motion.button>
          )}
        </AnimatePresence>

        {/* Search - CSS handles hiding at compact mobile */}
        <button
          className={styles.iconButton}
          onClick={onOpenCommandPalette}
          aria-label="Search or commands"
        >
          <SearchIcon />
        </button>

        {/* Keyboard reordering (Alt+Arrow) has no visual pick-up cue, so the
            resulting position is announced instead. */}
        <div className={styles.srOnly} role="status" aria-live="polite">
          {reorderAnnouncement}
        </div>

        {/* View Tabs - shown when they fit (see useDropdownSwitcher) */}
        <div
          className={`${styles.viewTabs} ${useDropdownSwitcher ? styles.viewTabsCollapsed : ''}`}
          ref={viewTabsRef}
          data-component="view-switcher"
        >
          <div
            className={styles.viewTabIndicator}
            style={{
              left: indicatorStyle.left,
              width: indicatorStyle.width,
              // The indicator is positioned from the active tab's layout box,
              // which drag transforms don't move — so it has to be shifted by
              // the same amount to stay under its tab.
              transform: `translateX(${tabReorder.shiftFor(activeTabIndex)}px)`,
            }}
            data-component="view-switcher-indicator"
          />
          {switcherItems.map((item, index) => {
            const isDragging = tabReorder.draggingId === item.id
            const shift = tabReorder.shiftFor(index)

            if (item.kind === 'divider') {
              return (
                <button
                  key="divider"
                  type="button"
                  ref={(el) => {
                    if (el) viewTabRefs.current.set('divider', el)
                    else viewTabRefs.current.delete('divider')
                  }}
                  className={`${styles.viewTabDivider} ${isDragging ? styles.viewTabDividerDragging : ''}`}
                  style={{
                    transform: shift === 0 ? undefined : `translateX(${shift}px)`,
                    transition: isDragging ? 'none' : undefined,
                    zIndex: isDragging ? 2 : undefined,
                  }}
                  data-component="view-switcher-divider"
                  aria-label="Tab group divider — drag, or use Alt+arrow keys, to move"
                  onPointerDown={(e) => tabReorder.onTabPointerDown(e, index)}
                  onKeyDown={(e) => tabReorder.onTabKeyDown(e, index)}
                  // It only exists to be repositioned; a click does nothing.
                  onClick={() => tabReorder.consumeDragClick()}
                />
              )
            }

            const view = item.view
            const isActive =
              currentView === view.value || (view.value === 'week' && currentView === '3day')
            const menu = tabMenus[view.value]
            // The dragged tab tracks the pointer directly; its neighbours
            // animate into the gap it leaves.
            const dragStyle: React.CSSProperties = {
              transform: shift === 0 ? undefined : `translateX(${shift}px)`,
              transition: isDragging ? 'none' : undefined,
              zIndex: isDragging ? 2 : undefined,
              position: isDragging ? 'relative' : undefined,
            }
            const tabButton = (
              <button
                ref={(el) => {
                  if (el) viewTabRefs.current.set(view.value, el)
                  else viewTabRefs.current.delete(view.value)
                }}
                className={`${styles.viewTab} ${isActive ? styles.viewTabActive : ''} ${
                  isDragging ? styles.viewTabDragging : ''
                }`}
                style={menu ? undefined : dragStyle}
                data-view={view.value}
                onPointerDown={(e) => tabReorder.onTabPointerDown(e, index)}
                onKeyDown={(e) => tabReorder.onTabKeyDown(e, index)}
                onClick={() => {
                  // A drag ends with a click on the same button; don't let it
                  // double as a view switch.
                  if (tabReorder.consumeDragClick()) return
                  handleViewChange(view.value)
                }}
              >
                {view.label}
              </button>
            )
            return (
              <React.Fragment key={view.value}>
                {menu ? (
                  <div
                    className={styles.viewTabItem}
                    style={dragStyle}
                    onMouseEnter={(e) => {
                      // Hovering mid-drag would pop a menu open under the
                      // pointer.
                      if (tabReorder.draggingId) return
                      openTabMenuFor(view.value, e.currentTarget)
                    }}
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
        {/* View Dropdown - shown when the tab strip doesn't fit (see useDropdownSwitcher) */}
        <div
          className={`${styles.viewDropdown} ${useDropdownSwitcher ? '' : styles.viewDropdownCollapsed}`}
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
          <div className={styles.viewDropdownTriggerWrap}>
            <button
              className={styles.viewDropdownButton}
              onClick={() => {
                // On mouse devices, onMouseEnter already opened this on
                // hover-in, so an unconditional toggle here would immediately
                // close it again on the same click that opened it. Only touch
                // devices (no hover events) need the click to toggle.
                if ('ontouchstart' in window) {
                  setIsViewDropdownOpen((prev) => !prev)
                } else {
                  setIsViewDropdownOpen(true)
                }
              }}
              aria-haspopup="menu"
              aria-expanded={isViewDropdownOpen}
              aria-controls="view-dropdown-menu"
              data-component="view-dropdown-trigger"
            >
              {ALL_VIEWS.find((v) => v.value === currentView)?.label}
              <svg
                aria-hidden="true"
                width="12"
                height="12"
                viewBox="0 0 12 12"
                fill="none"
                className={`${styles.viewDropdownArrow} ${isViewDropdownOpen ? styles.viewDropdownArrowOpen : ''}`}
              >
                <path
                  d="M3 4.5L6 7.5L9 4.5"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>
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
                  viewDropdownRef.current
                    ?.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')
                    ?.focus()
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
                  nextIndex =
                    currentIndex < 0
                      ? items.length - 1
                      : (currentIndex - 1 + items.length) % items.length
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
              {visibleViews.map((view, index) => (
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
            <div
              className={`${styles.quickSettingsDropdown} ${quickSettings.closing ? styles.quickSettingsClosing : ''}`}
            >
              <QuickSettingsPanel />
            </div>
          )}
        </div>
      </div>
    </header>
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
      strokeWidth="1.5"
      strokeLinecap="round"
    >
      <path d="M3 10H17M3 6H17M3 14H17" />
    </svg>
  )
}

function TodayIcon(): JSX.Element {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none">
      <rect x="3.5" y="5" width="17" height="15.5" rx="3" stroke="currentColor" strokeWidth="1.6" />
      <path d="M3.5 9.5H20.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="M8 3V6.3M16 3V6.3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <rect x="10.1" y="12.1" width="3.8" height="3.8" rx="1" fill="currentColor" />
    </svg>
  )
}

function SearchIcon(): JSX.Element {
  return (
    <svg
      width="18"
      height="18"
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

function SettingsIcon(): JSX.Element {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  )
}
