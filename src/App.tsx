import type { JSX, MouseEvent as ReactMouseEvent } from 'react'
import { useCallback, useEffect, useState, useRef, lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, useNavigate, useLocation } from 'react-router-dom'
import { Toaster } from 'sonner'
import { Capacitor } from '@capacitor/core'
import type { PluginListenerHandle } from '@capacitor/core'
import { App as CapacitorApp } from '@capacitor/app'
import { useIsMobile } from './hooks/useIsMobile'
import { DUR_FAST } from './lib/motion'
import { useTwoFingerSwipe } from './hooks/useTwoFingerSwipe'
import { useHorizontalSwipe } from './hooks/useHorizontalSwipe'
import { shouldPageOnSwipe, SWIPE_SCROLLER_ATTR } from './features/calendar/swipePaging'
import { usePullToRefresh } from './hooks/usePullToRefresh'
import { useMatchMedia } from './hooks/useMatchMedia'
import { useCalendarStore } from './store/calendarStore'
import { useHistoryStore } from './store/historyStore'
import { showToast } from './lib/toast'
import { hapticIfEnabled } from './lib/haptics'
import { useSettingsStore } from './store/settingsStore'
// Imported from their modules rather than through a features/calendar barrel:
// the barrel also re-exported YearView, so pulling these four in eagerly
// dragged YearView along and silently cancelled its lazy() split below.
import { CalendarHeader } from './features/calendar/components/CalendarHeader'
import { Sidebar } from './features/calendar/components/Sidebar'
import { EventModal } from './features/calendar/components/EventModal'
import { EventPreviewPopup } from './features/calendar/components/EventPreviewPopup'
import { JournalDayModal } from './features/calendar/components/JournalDayModal'
import { CookieConsent, ErrorBoundary } from './components/common'
import { useTheme } from './components/ThemeContext'
import { CalendarSkeleton } from './components/common/Skeleton'
import { FloatingNavPill } from './features/calendar/components/nav/FloatingNavPill'
import { OnboardingModal } from './features/onboarding/OnboardingModal'
import { ShortcutsHelp } from './features/calendar/components/ShortcutsHelp'
// TEMPORARY — prototype for issue #31. Lazy + DEV-gated so it never reaches a
// production bundle. Remove with the feature directory once a tint is chosen.
const EventTintPrototype = import.meta.env.DEV
  ? lazy(() =>
      import('./features/devtools/EventTintPrototype').then((m) => ({
        default: m.EventTintPrototype,
      })),
    )
  : null
import { SetupPage } from './features/setup/SetupPage'
import { MasterPasswordPrompt } from './features/settings/components/MasterPasswordPrompt'
import { useConfigStore } from './store/configStore'
import { ThemeProvider } from './components/ThemeProvider'
import { useCardDAV } from './features/carddav/hooks/useCardDAV'
import { initContactPhotos } from './lib/contactPhotoSync'
import { useCalDAV } from './features/caldav/hooks/useCalDAV'
import { useNativeKeyboard } from './hooks/useNativeKeyboard'
import { useNotifications } from './hooks/useNotifications'
import { openEventDeepLink } from './lib/deepLink'
import { AIPhotoImportRoot } from './features/aiVision/components/AIPhotoImportRoot'
import { useAIPhotoImport } from './features/aiVision/useAIPhotoImport'
import type { ViewType } from './types'

import { findEventById } from './lib/events'
import { shortcutsSuppressed } from './lib/keyboard'
import { motion, AnimatePresence } from 'framer-motion'
import type { PanInfo } from 'framer-motion'
import { useReducedMotion } from './hooks/useReducedMotion'
import { VIEW_ROUTES, URL_TO_VIEW } from './features/calendar/viewRoutes'
import { useViewCycleOrder } from './features/calendar/useOrderedViews'
import { getNavigatedDate } from './features/calendar/dateNavigation'
import { format, parseISO } from 'date-fns'

import './App.css'

const CalendarGrid = lazy(() =>
  import('./features/calendar/components/CalendarGrid').then((m) => ({ default: m.CalendarGrid }))
)
const WeekView = lazy(() =>
  import('./features/calendar/components/WeekView').then((m) => ({ default: m.WeekView }))
)
const DayView = lazy(() =>
  import('./features/calendar/components/DayView').then((m) => ({ default: m.DayView }))
)
const AgendaView = lazy(() =>
  import('./features/calendar/components/AgendaView').then((m) => ({ default: m.AgendaView }))
)
const TodoView = lazy(() =>
  import('./features/calendar/components/TodoView').then((m) => ({ default: m.TodoView }))
)
const JournalView = lazy(() =>
  import('./features/calendar/components/JournalView').then((m) => ({ default: m.JournalView }))
)
const ContactsView = lazy(() =>
  import('./features/carddav/components/ContactsView').then((m) => ({ default: m.ContactsView }))
)
const YearView = lazy(() =>
  import('./features/calendar/components/YearView').then((m) => ({ default: m.YearView }))
)

// Whole routes of their own — nothing here is needed to paint a calendar, so
// they stay out of the initial bundle.
const SettingsPage = lazy(() =>
  import('./features/settings/components/SettingsPage').then((m) => ({ default: m.SettingsPage }))
)
const PrivacyPolicy = lazy(() =>
  import('./features/settings/components/PrivacyPolicy').then((m) => ({ default: m.PrivacyPolicy }))
)
const CommandPalette = lazy(() =>
  import('./features/commandPalette/components/CommandPalette').then((m) => ({
    default: m.CommandPalette,
  }))
)

function ViewLoader({
  children,
  viewKey,
}: {
  children: JSX.Element
  viewKey: ViewType
}): JSX.Element {
  const reducedMotion = useReducedMotion()
  return (
    // Suspense sits OUTSIDE the animated element on purpose. When it was
    // inside, the opacity fade started the moment the motion.div mounted —
    // i.e. while the lazy chunk was still evaluating and the view was still
    // doing its first (expensive) render — so the fade competed with the
    // mount for the main thread and visibly stuttered. With the boundary
    // outside, the skeleton holds the slot while the chunk loads and the
    // motion.div only mounts once the real view is ready to paint, so the
    // fade has the frame budget to itself.
    <Suspense fallback={<CalendarSkeleton view={viewKey} />}>
      <AnimatePresence mode="wait">
        <motion.div
          key={viewKey}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reducedMotion ? 0 : DUR_FAST }}
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            minHeight: 0,
            overflow: 'hidden',
          }}
        >
          {children}
        </motion.div>
      </AnimatePresence>
    </Suspense>
  )
}

function useViewManager(): void {
  const navigate = useNavigate()
  const location = useLocation()
  const currentView = useCalendarStore((state) => state.currentView)
  const setCurrentView = useCalendarStore((state) => state.setCurrentView)
  const isMobile = useIsMobile()

  const isMounted = useRef(false)
  const lastUrlView = useRef<ViewType | null>(null)
  const currentViewRef = useRef(currentView)

  // Cycling follows the user's own switcher arrangement. Held in a ref so
  // reordering doesn't tear down and re-register the keydown listener.
  const cycleOrder = useViewCycleOrder()
  const cycleOrderRef = useRef(cycleOrder)
  useEffect(() => {
    cycleOrderRef.current = cycleOrder
  }, [cycleOrder])

  // Keep ref in sync with state
  useEffect(() => {
    currentViewRef.current = currentView
  }, [currentView])

  useEffect(() => {
    isMounted.current = true
  }, [])

  // Check if we're in the middle of a GitHub Pages redirect
  // The redirect URL format is /?/path or /?/path&query
  const isRedirecting = location.search.startsWith('?/')

  // Any path that maps to a view is a calendar route — including views the
  // user has switched off, whose routes still resolve if navigated to
  // directly.
  const isCalendarRoute = URL_TO_VIEW[location.pathname] !== undefined
  const isRootRoute = location.pathname === '/'

  // Sync URL -> State (only when URL changes externally)
  useEffect(() => {
    if (!isMounted.current) return
    if (isRedirecting) return // Wait for GitHub Pages redirect to complete

    // Handle root route - redirect to default view
    if (isRootRoute) {
      navigate(isMobile ? '/agenda' : '/month', { replace: true })
      return
    }

    if (!isCalendarRoute) return

    const viewFromUrl = URL_TO_VIEW[location.pathname]
    if (viewFromUrl && viewFromUrl !== lastUrlView.current) {
      lastUrlView.current = viewFromUrl
      if (viewFromUrl !== currentViewRef.current) {
        setCurrentView(viewFromUrl)
      }
    }
  }, [
    location.pathname,
    setCurrentView,
    isCalendarRoute,
    isRootRoute,
    isRedirecting,
    navigate,
    isMobile,
  ])

  // Handle keyboard shortcuts - navigate and update state
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      // Ignore if typing, or a modal/overlay is open
      if (shortcutsSuppressed(e)) return

      // Ignore if Ctrl or Cmd is held (browser shortcuts like Ctrl+< etc.)
      if (e.ctrlKey || e.metaKey) return

      const cycle = cycleOrderRef.current
      let newView: ViewType | null = null
      if (e.key === '<' || e.key === ',') {
        e.preventDefault()
        const currentIndex = cycle.indexOf(currentViewRef.current)
        const prevIndex = (currentIndex - 1 + cycle.length) % cycle.length
        newView = cycle[prevIndex]
      } else if (e.key === '>' || e.key === '.') {
        e.preventDefault()
        const currentIndex = cycle.indexOf(currentViewRef.current)
        const nextIndex = (currentIndex + 1) % cycle.length
        newView = cycle[nextIndex]
      }

      if (newView) {
        lastUrlView.current = newView
        setCurrentView(newView)
        navigate(VIEW_ROUTES[newView], { replace: true })
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [setCurrentView, navigate])
}

function PreviewPopupWrapper(): JSX.Element | null {
  const previewEventId = useCalendarStore((state) => state.previewEventId)
  const previewPosition = useCalendarStore((state) => state.previewPosition)
  const events = useCalendarStore((state) => state.events)

  if (!previewEventId || !previewPosition) return null

  const event = findEventById(events, previewEventId)
  if (!event) return null

  return (
    <EventPreviewPopup event={event} position={previewPosition} clickedEventId={previewEventId} />
  )
}

function CalendarApp(): JSX.Element {
  const navigate = useNavigate()
  const location = useLocation()
  const currentView = useCalendarStore((state) => state.currentView)
  const setOverlayOpen = useCalendarStore((state) => state.setOverlayOpen)
  const setShowAddCalendar = useCalendarStore((state) => state.setShowAddCalendar)
  const openModal = useCalendarStore((state) => state.openModal)
  const isJournalModalOpen = useCalendarStore((state) => state.isJournalModalOpen)
  const journalModalDate = useCalendarStore((state) => state.journalModalDate)
  const journalStartInCompose = useCalendarStore((state) => state.journalStartInCompose)
  const closeJournalModal = useCalendarStore((state) => state.closeJournalModal)
  const { importFromCamera } = useAIPhotoImport()
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false)
  // The palette is a lazy chunk, so it can't be mounted from the start. Once
  // it has been opened it stays mounted, because it plays its own close
  // animation off the isOpen prop and unmounting would cut that short.
  const [paletteMounted, setPaletteMounted] = useState(false)
  const [isShortcutsHelpOpen, setIsShortcutsHelpOpen] = useState(false)
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const sidebarCollapsed = useSettingsStore((state) => state.sidebarCollapsed)
  const agendaSidebarOpen = useSettingsStore((state) => state.agendaSidebarOpen)
  const agendaSidebarWidth = useSettingsStore((state) => state.agendaSidebarWidth)
  const updateSettings = useSettingsStore((state) => state.updateSettings)
  const isMobile = useIsMobile()
  const isSidebarDrawerMode = useMatchMedia('(max-width: 950px)')
  const mainRef = useRef<HTMLElement>(null)
  const reducedMotion = useReducedMotion()

  // Initialize CardDAV sync
  useCardDAV()

  // Contact photos live in IndexedDB, not in the persisted contact blob — put
  // them back on the live contacts and mirror later edits out.
  useEffect(() => {
    void initContactPhotos()
  }, [])

  // Mount the palette (closed) as soon as its chunk lands, one frame after the
  // first paint.
  //
  // Mounting is the expensive part, not fetching: the palette builds its
  // command list and scans every event and contact in useMemo on first render.
  // Before it was code-split it was always mounted with isOpen={false}, so that
  // work happened during startup and opening was instant. Deferring the mount
  // to the first ⌘K moved all of it onto that keypress — which is why merely
  // preloading the chunk didn't help. Mounting it closed, off the critical
  // path, restores the old timing while keeping it out of the entry bundle.
  useEffect(() => {
    let cancelled = false
    const frame = requestAnimationFrame(() => {
      void import('./features/commandPalette/components/CommandPalette').then(() => {
        if (!cancelled) setPaletteMounted(true)
      })
    })
    return () => {
      cancelled = true
      cancelAnimationFrame(frame)
    }
  }, [])

  // Safety net for an open that beats the preload — Suspense covers the gap.
  useEffect(() => {
    if (isCommandPaletteOpen) setPaletteMounted(true)
  }, [isCommandPaletteOpen])

  // Fire event/task reminders (web: polling + Notification API; native:
  // real OS-scheduled notifications). Was defined but never mounted anywhere
  // in the app — reminders have never actually fired, on web or native.
  useNotifications()

  // Keep the focused field above the Android on-screen keyboard.
  useNativeKeyboard()

  useViewManager()

  // Mobile: pull down from the top of the current view to manually trigger
  // a CalDAV sync.
  const { syncAll } = useCalDAV()
  const { pullDistance, isRefreshing } = usePullToRefresh(mainRef, {
    onRefresh: syncAll,
    enabled: isMobile,
  })

  // Mobile: edge swipe from the left screen edge opens the sidebar drawer.
  // Attached to `document` (not the drawer itself, which is off-screen while
  // closed) — see useHorizontalSwipe's doc comment for why this isn't a real
  // overlay element.
  useHorizontalSwipe('document', {
    onSwipeRight: () => {
      setIsSidebarOpen(true)
      hapticIfEnabled('light')
    },
    enabled: isSidebarDrawerMode && !isSidebarOpen,
    edgeZonePx: 24,
  })

  // Mobile: two-finger horizontal swipe cycles through views (single-finger
  // swipes stay reserved for date navigation inside each view).
  const currentViewRef = useRef(currentView)
  useEffect(() => {
    currentViewRef.current = currentView
  }, [currentView])
  const cycleOrder = useViewCycleOrder()
  const switchViewBy = useCallback(
    (direction: 'left' | 'right') => {
      const currentIndex = cycleOrder.indexOf(currentViewRef.current)
      const delta = direction === 'left' ? 1 : -1
      const nextIndex = (currentIndex + delta + cycleOrder.length) % cycleOrder.length
      const newView = cycleOrder[nextIndex]
      useCalendarStore.getState().setCurrentView(newView)
      navigate(VIEW_ROUTES[newView], { replace: true })
    },
    [navigate, cycleOrder]
  )
  useTwoFingerSwipe(mainRef, { onSwipe: switchViewBy, enabled: isMobile })

  // Mobile: single-finger horizontal swipe on the content area pages the
  // current view's date by one unit (month/week/day/year, matching the
  // header's chevron navigation). Views without date paging (todo/journal/
  // contacts) no-op.
  // A pan that starts on a resize handle belongs to that handle. `motion.main`
  // wraps the whole view, so dragging the month/agenda divider with any
  // sideways wander cleared the 60px threshold here and paged the date out from
  // under the drag. The handles stop propagation of nothing — framer-motion
  // tracks the pointer at the container — so the start target is what has to be
  // checked. Recorded on pan start because by pan end the event has retargeted
  // to whatever is under the finger.
  const panStartedOnHandleRef = useRef(false)
  const handleContentPanStart = useCallback((event: PointerEvent) => {
    const target = event.target
    panStartedOnHandleRef.current =
      target instanceof Element && target.closest('[data-resize-handle]') !== null
  }, [])

  const handleContentPanEnd = useCallback(
    (_event: PointerEvent, info: PanInfo) => {
      if (!isMobile) return
      if (panStartedOnHandleRef.current) {
        panStartedOnHandleRef.current = false
        return
      }
      const view = currentViewRef.current
      if (view === 'todo' || view === 'journal' || view === 'contacts') return

      const passedDistance = Math.abs(info.offset.x) > 60
      const passedVelocity = Math.abs(info.velocity.x) > 500
      if (!passedDistance && !passedVelocity) return

      const direction: 'prev' | 'next' = info.offset.x < 0 ? 'next' : 'prev'

      // A view can carry a horizontally-scrolling strip directly under this
      // pan — the mobile week view's day columns do. Those get first claim:
      // page only once the strip is already at the edge the swipe is heading
      // towards, otherwise a flick meant to reveal the next day jumped a
      // whole week.
      if (!shouldPageOnSwipe(direction, document.querySelector(`[${SWIPE_SCROLLER_ATTR}]`))) {
        return
      }

      const state = useCalendarStore.getState()
      const newDate = getNavigatedDate(view, parseISO(state.currentDate), direction)
      state.setCurrentDate(format(newDate, 'yyyy-MM-dd'))
    },
    [isMobile]
  )

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      // Ignore if typing, or a modal/overlay is open
      if (shortcutsSuppressed(e)) return

      // Cmd/Ctrl+K → open command palette (must be before the ctrlKey guard)
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setIsCommandPaletteOpen(true)
        setOverlayOpen(true)
        return
      }

      // Cmd/Ctrl+Z → undo, Cmd/Ctrl+Shift+Z (or Ctrl+Y) → redo
      if ((e.metaKey || e.ctrlKey) && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault()
        if (e.shiftKey) {
          if (useHistoryStore.getState().redo()) showToast('Redo')
        } else {
          if (useHistoryStore.getState().undo()) showToast('Undo')
        }
        return
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault()
        if (useHistoryStore.getState().redo()) showToast('Redo')
        return
      }

      // Ignore single-key shortcuts if Ctrl or Cmd is held
      if (e.ctrlKey || e.metaKey) return

      const path = window.location.pathname
      const isSettings = path.startsWith('/settings')

      // Escape in settings → go back to calendar
      if (e.key === 'Escape' && isSettings) {
        e.preventDefault()
        navigate('/')
        return
      }

      // Don't handle single-key shortcuts on settings or other non-calendar routes
      if (isSettings) return

      // T → go to today
      if (e.key === 't' || e.key === 'T') {
        e.preventDefault()
        const today = new Date().toISOString().split('T')[0]
        useCalendarStore.getState().setCurrentDate(today)
        return
      }

      // C → create new event
      if (e.key === 'c' || e.key === 'C') {
        e.preventDefault()
        openModal()
        return
      }

      // K → create new task
      if (e.key === 'k' || e.key === 'K') {
        e.preventDefault()
        openModal(undefined, undefined, undefined, 'task')
        return
      }

      // ? → show keyboard shortcuts (also Shift+/ on most layouts)
      if (e.key === '?' || (e.key === '/' && e.shiftKey)) {
        e.preventDefault()
        setIsShortcutsHelpOpen(true)
        setOverlayOpen(true)
        return
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [setOverlayOpen, navigate, openModal])

  // Hardware back button (Android): close the top-most overlay, one level
  // per press. Modals already close themselves on Escape (EventModal,
  // JournalDayModal, CommandPalette) so a synthetic Escape keydown reuses
  // that logic instead of duplicating close calls here.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return

    const listenerPromise = CapacitorApp.addListener('backButton', () => {
      if (
        isCommandPaletteOpen ||
        isShortcutsHelpOpen ||
        isJournalModalOpen ||
        useCalendarStore.getState().isModalOpen
      ) {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
        return
      }
      if (isSidebarOpen) {
        setIsSidebarOpen(false)
        return
      }
      if (window.location.pathname !== '/') {
        navigate('/')
        return
      }
      void CapacitorApp.exitApp()
    })

    return () => {
      void listenerPromise.then((handle) => handle.remove())
    }
  }, [isCommandPaletteOpen, isShortcutsHelpOpen, isJournalModalOpen, isSidebarOpen, navigate])

  // importFromCamera is a plain function re-created every render (not
  // useCallback-wrapped), so it can't go in the effect's dependency array
  // without re-running the effect — and re-registering the appUrlOpen
  // listener — on every render. Same latest-ref pattern as
  // JournalView.tsx's handleSaveEntryRef.
  const importFromCameraRef = useRef(importFromCamera)
  useEffect(() => {
    importFromCameraRef.current = importFromCamera
  })

  // Android home-screen shortcuts (long-press app icon → New event / New task
  // / Photo import / Search). "New event"/"New task"/"Search" are static
  // shortcuts (android/app/.../res/xml/shortcuts.xml); "Photo import" is a
  // dynamic one (DynamicShortcutsPlugin.java) only pushed once AI photo
  // import is configured (see aiVisionSettingsStore.ts). All open the app via
  // the `calino.malinov.ski://<action>` custom scheme; Capacitor's App plugin
  // surfaces that as `appUrlOpen` (warm start, app already running) or
  // `getLaunchUrl()` (cold start, app was launched by it).
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return

    const handleShortcutUrl = (url: string): void => {
      const action = url.split('://')[1]?.split(/[/?]/)[0]
      switch (action) {
        case 'new-event':
          openModal()
          break
        case 'new-task':
          openModal(undefined, undefined, undefined, 'task')
          break
        case 'ai-photo-import':
          void importFromCameraRef.current()
          break
        case 'search':
          setIsCommandPaletteOpen(true)
          setOverlayOpen(true)
          break
      }
    }

    void CapacitorApp.getLaunchUrl().then((result) => {
      if (result?.url) handleShortcutUrl(result.url)
    })

    const listenerPromise = CapacitorApp.addListener('appUrlOpen', ({ url }) => {
      handleShortcutUrl(url)
    })

    return () => {
      void listenerPromise.then((handle) => handle.remove())
    }
  }, [openModal, setOverlayOpen])

  // Web: opening a reminder notification navigates to `/?date=&event=` (see
  // showNotification's onclick handler in lib/notifications.ts) — read those
  // params back out and open that event, then strip them so a later reload
  // doesn't re-open the modal. The native equivalent lives in
  // nativeReminders.ts's listenForReminderActions, which calls the same
  // openEventDeepLink helper directly (no URL round-trip needed there).
  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const eventId = params.get('event')
    const date = params.get('date')
    if (eventId && date) {
      openEventDeepLink(eventId, date)
      navigate(location.pathname, { replace: true })
    }
  }, [location.pathname, location.search, navigate])

  const renderView = (): JSX.Element => {
    const viewElement = (() => {
      switch (currentView) {
        case 'month':
          return <CalendarGrid />
        case 'year':
          return <YearView />
        case 'week':
          return <WeekView />
        case '3day':
          return <WeekView dayCount={3} />
        case 'day':
          return <DayView />
        case 'agenda':
          return <AgendaView />
        case 'todo':
          return <TodoView />
        case 'journal':
          return <JournalView />
        case 'contacts':
          return <ContactsView />
        default:
          return <CalendarGrid />
      }
    })()
    // Key the boundary on the view so switching views remounts a fresh
    // boundary and recovers from a crashed view without a full reload.
    return (
      <ErrorBoundary key={currentView}>
        <ViewLoader viewKey={currentView}>{viewElement}</ViewLoader>
      </ErrorBoundary>
    )
  }

  const handleToggleSidebar = useCallback(() => {
    if (window.innerWidth <= 950) {
      setIsSidebarOpen((prev) => !prev)
    } else {
      updateSettings({ sidebarCollapsed: !sidebarCollapsed })
    }
  }, [sidebarCollapsed, updateSettings])

  const handleCloseSidebar = useCallback(() => {
    setIsSidebarOpen(false)
  }, [])

  const handleOpenCommandPalette = useCallback(() => {
    setIsCommandPaletteOpen(true)
    setOverlayOpen(true)
  }, [setOverlayOpen])

  // Right-hand agenda panel resize. The panel sits on the right, so dragging
  // its left edge leftwards (negative delta) widens it.
  const handleAgendaResizeStart = useCallback(
    (e: ReactMouseEvent): void => {
      e.preventDefault()
      const startX = e.clientX
      const startWidth = useSettingsStore.getState().agendaSidebarWidth
      const onMove = (ev: MouseEvent): void => {
        const delta = ev.clientX - startX
        const newWidth = Math.min(560, Math.max(260, startWidth - delta))
        updateSettings({ agendaSidebarWidth: newWidth })
      }
      const onUp = (): void => {
        document.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseup', onUp)
        document.body.style.userSelect = ''
      }
      document.body.style.userSelect = 'none'
      document.addEventListener('mousemove', onMove)
      document.addEventListener('mouseup', onUp)
    },
    [updateSettings]
  )

  return (
    <div className="app">
      <CalendarHeader
        onToggleSidebar={handleToggleSidebar}
        onOpenCommandPalette={handleOpenCommandPalette}
      />
      <div className="appContent" data-sidebar-collapsed={sidebarCollapsed || undefined}>
        <ErrorBoundary fallback={null}>
          <Sidebar
            isOpen={isSidebarOpen}
            onClose={handleCloseSidebar}
            isCollapsed={sidebarCollapsed}
            onCollapsedChange={(v) => updateSettings({ sidebarCollapsed: v })}
          />
        </ErrorBoundary>
        {isMobile && (
          <div
            className="pullToRefreshIndicator"
            data-active={isRefreshing || undefined}
            style={{
              transform: `translateX(-50%) translateY(${isRefreshing ? 24 : Math.min(pullDistance, 60)}px)`,
              opacity: isRefreshing || pullDistance > 0 ? 1 : 0,
            }}
            aria-hidden={!isRefreshing}
          >
            <span className="pullToRefreshSpinner" />
          </div>
        )}
        <motion.main
          className="main"
          ref={mainRef}
          data-view={currentView}
          onPanStart={isMobile ? handleContentPanStart : undefined}
          onPanEnd={isMobile ? handleContentPanEnd : undefined}
          style={isMobile ? { touchAction: 'pan-y' } : undefined}
        >
          {renderView()}
        </motion.main>
        <AnimatePresence>
          {agendaSidebarOpen && (
            // The panel used to animate `width: 0 -> agendaSidebarWidth`,
            // which relayouts this (large, lazily-mounting) subtree on every
            // frame. Now the outer <aside> is a fixed-width `overflow: hidden`
            // wrapper that takes its final width in a single layout pass, and
            // only the inner panel moves, via a compositor-friendly transform.
            <motion.aside
              key="agenda-sidebar"
              className="agendaSidebar"
              style={{ width: agendaSidebarWidth }}
            >
              <motion.div
                className="agendaSidebarPanel"
                style={{
                  position: 'relative',
                  width: agendaSidebarWidth,
                  height: '100%',
                  display: 'flex',
                  flexDirection: 'column',
                  minHeight: 0,
                }}
                initial={{ x: '100%', opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: '100%', opacity: 0 }}
                transition={{ duration: reducedMotion ? 0 : 0.2, ease: [0.32, 0.72, 0, 1] }}
              >
                <div
                  className="agendaSidebarResizer"
                  onMouseDown={handleAgendaResizeStart}
                  role="separator"
                  aria-orientation="vertical"
                  aria-label="Resize agenda panel"
                />
                <div className="agendaSidebarHeader">
                  <span>Agenda</span>
                  <button
                    className="agendaSidebarClose"
                    onClick={() => updateSettings({ agendaSidebarOpen: false })}
                    aria-label="Close agenda panel"
                  >
                    ×
                  </button>
                </div>
                <div className="agendaSidebarBody">
                  <ErrorBoundary fallback={null}>
                    <Suspense fallback={null}>
                      <AgendaView embedded />
                    </Suspense>
                  </ErrorBoundary>
                </div>
              </motion.div>
            </motion.aside>
          )}
        </AnimatePresence>
      </div>
      <FloatingNavPill
        onToggleSidebar={handleToggleSidebar}
        onOpenSearch={handleOpenCommandPalette}
      />
      {EventTintPrototype && (
        <Suspense fallback={null}>
          <EventTintPrototype />
        </Suspense>
      )}
      <ErrorBoundary fallback={null}>
        <EventModal />
      </ErrorBoundary>
      <ErrorBoundary fallback={null}>
        <AIPhotoImportRoot />
      </ErrorBoundary>
      {isJournalModalOpen && journalModalDate && (
        <JournalDayModal
          isOpen={isJournalModalOpen}
          date={journalModalDate}
          startInCompose={journalStartInCompose}
          onClose={closeJournalModal}
        />
      )}
      <PreviewPopupWrapper />
      {paletteMounted && (
        <Suspense fallback={null}>
          <CommandPalette
            isOpen={isCommandPaletteOpen}
            onClose={() => {
              setIsCommandPaletteOpen(false)
              setOverlayOpen(false)
            }}
            toggleSidebar={handleToggleSidebar}
            sidebarOpen={window.innerWidth <= 950 ? isSidebarOpen : !sidebarCollapsed}
          />
        </Suspense>
      )}
      <OnboardingModal onAddCalendar={() => setShowAddCalendar(true)} />
      <ShortcutsHelp
        isOpen={isShortcutsHelpOpen}
        onClose={() => {
          setIsShortcutsHelpOpen(false)
          setOverlayOpen(false)
        }}
      />
    </div>
  )
}

function GitHubPagesRedirect(): null {
  const location = useLocation()
  const navigate = useNavigate()

  useEffect(() => {
    if (location.search.startsWith('?/')) {
      const query = location.search.slice(2)
      const parts = query.split('&')
      const path = parts[0].replace(/~and~/g, '&')
      const search = parts[1] ? '?' + parts[1].replace(/~and~/g, '&') : ''
      navigate(path + search + location.hash, { replace: true })
    }
  }, [location, navigate])

  return null
}

function App(): JSX.Element {
  const loadConfigFile = useConfigStore((state) => state.loadConfigFile)

  // Load self-hosted config on mount. Explicitly caught: a missing or malformed
  // config file is a non-fatal condition (the app falls back to defaults), and
  // an uncaught rejection here would surface as an unhandled promise rejection.
  useEffect(() => {
    loadConfigFile().catch((err) => {
      console.warn('[config] Failed to load config file:', err)
    })
  }, [loadConfigFile])

  // Fix for Android native time picker backdrop remaining after app switch
  useEffect(() => {
    const blurNativePickers = (): void => {
      const active = document.activeElement as HTMLElement
      if (active?.tagName === 'INPUT') {
        const type = (active as HTMLInputElement).type
        if (type === 'time' || type === 'date' || type === 'datetime-local') {
          active.blur()
        }
      }
    }

    const handleVisibilityChange = (): void => {
      if (document.visibilityState === 'hidden') blurNativePickers()
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)

    // `cancelled` matters because addListener resolves asynchronously: if
    // cleanup runs first (StrictMode's double-mount, fast route churn), the
    // handle arrives after we'd already tried to remove it and the listener
    // would leak — one per mount.
    let cancelled = false
    let capListener: PluginListenerHandle | null = null
    if (Capacitor.isNativePlatform()) {
      CapacitorApp.addListener('appStateChange', ({ isActive }) => {
        if (!isActive) blurNativePickers()
      })
        .then((listener) => {
          if (cancelled) {
            void listener.remove()
            return
          }
          capListener = listener
        })
        .catch(() => {})
    }

    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      if (capListener) void capListener.remove()
    }
  }, [])

  return (
    <BrowserRouter>
      <ThemeProvider>
        <GitHubPagesRedirect />
        <ThemedToaster />
        {!Capacitor.isNativePlatform() && <CookieConsent />}
        <MasterPasswordPrompt />
        <Routes>
          <Route path="/month" element={<CalendarApp />} />
          <Route path="/year" element={<CalendarApp />} />
          <Route path="/week" element={<CalendarApp />} />
          <Route path="/3day" element={<CalendarApp />} />
          <Route path="/day" element={<CalendarApp />} />
          <Route path="/agenda" element={<CalendarApp />} />
          <Route path="/tasks" element={<CalendarApp />} />
          <Route path="/journal" element={<CalendarApp />} />
          <Route path="/contacts" element={<CalendarApp />} />
          <Route path="/" element={<CalendarApp />} />
          {/* No fallback: these are whole-page routes, and a spinner that
              flashes for one frame on a warm cache reads as a glitch. */}
          <Route
            path="/settings"
            element={
              <Suspense fallback={null}>
                <SettingsPage />
              </Suspense>
            }
          />
          <Route
            path="/privacy"
            element={
              <Suspense fallback={null}>
                <PrivacyPolicy />
              </Suspense>
            }
          />
          <Route path="/setup" element={<SetupPage />} />
        </Routes>
      </ThemeProvider>
    </BrowserRouter>
  )
}

function ThemedToaster(): JSX.Element {
  const { effectiveMode } = useTheme()
  const isMobile = useIsMobile()
  return (
    <Toaster
      theme={effectiveMode}
      // No richColors: saturated red/green is off-palette for a system with a
      // single accent. Toasts inherit the theme surface instead.
      position={isMobile ? 'bottom-center' : 'bottom-right'}
      duration={5000}
      // On mobile the floating nav pill owns the bottom of the screen, so lift
      // the toasts (including the Undo affordance) clear of it.
      offset={isMobile ? 'calc(88px + var(--safe-area-bottom))' : undefined}
      mobileOffset={{ bottom: 'calc(88px + var(--safe-area-bottom))' }}
    />
  )
}

export default App
