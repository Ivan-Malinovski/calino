import type { JSX, MouseEvent as ReactMouseEvent } from 'react'
import { useCallback, useEffect, useState, useRef, lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, useNavigate, useLocation } from 'react-router-dom'
import { Toaster } from 'sonner'
import { Capacitor } from '@capacitor/core'
import { App as CapacitorApp } from '@capacitor/app'
import { useIsMobile } from './hooks/useIsMobile'
import { useTwoFingerSwipe } from './hooks/useTwoFingerSwipe'
import { useHorizontalSwipe } from './hooks/useHorizontalSwipe'
import { useMatchMedia } from './hooks/useMatchMedia'
import { useCalendarStore } from './store/calendarStore'
import { useHistoryStore } from './store/historyStore'
import { showToast } from './lib/toast'
import { hapticIfEnabled } from './lib/haptics'
import { useSettingsStore } from './store/settingsStore'
import {
  CalendarHeader,
  Sidebar,
  EventModal,
  EventPreviewPopup,
} from './features/calendar'
import { JournalDayModal } from './features/calendar/components/JournalDayModal'
import { SettingsPage, PrivacyPolicy } from './features/settings'
import { CommandPalette } from './features/commandPalette'
import { CookieConsent, ErrorBoundary } from './components/common'
import { useTheme } from './components/ThemeContext'
import { CalendarSkeleton } from './components/common/Skeleton'
import { FloatingNavPill } from './features/calendar/components/nav/FloatingNavPill'
import { OnboardingModal } from './features/onboarding/OnboardingModal'
import { ShortcutsHelp } from './features/calendar/components/ShortcutsHelp'
import { SetupPage } from './features/setup/SetupPage'
import { MasterPasswordPrompt } from './features/settings/components/MasterPasswordPrompt'
import { useConfigStore } from './store/configStore'
import { ThemeProvider } from './components/ThemeProvider'
import { useCardDAV } from './features/carddav/hooks/useCardDAV'
import { useNotifications } from './hooks/useNotifications'
import type { ViewType } from './types'

import { findEventById } from './lib/events'
import { shortcutsSuppressed } from './lib/keyboard'
import { motion, AnimatePresence } from 'framer-motion'
import type { PanInfo } from 'framer-motion'
import { useReducedMotion } from './hooks/useReducedMotion'
import { VIEW_ROUTES, URL_TO_VIEW } from './features/calendar/viewRoutes'
import { getNavigatedDate } from './features/calendar/dateNavigation'
import { format, parseISO } from 'date-fns'

import './App.css'

const CalendarGrid = lazy(() => import('./features/calendar/components/CalendarGrid').then(m => ({ default: m.CalendarGrid })))
const WeekView = lazy(() => import('./features/calendar/components/WeekView').then(m => ({ default: m.WeekView })))
const DayView = lazy(() => import('./features/calendar/components/DayView').then(m => ({ default: m.DayView })))
const AgendaView = lazy(() => import('./features/calendar/components/AgendaView').then(m => ({ default: m.AgendaView })))
const TodoView = lazy(() => import('./features/calendar/components/TodoView').then(m => ({ default: m.TodoView })))
const JournalView = lazy(() => import('./features/calendar/components/JournalView').then(m => ({ default: m.JournalView })))
const ContactsView = lazy(() => import('./features/carddav/components/ContactsView').then(m => ({ default: m.ContactsView })))
const YearView = lazy(() => import('./features/calendar/components/YearView').then(m => ({ default: m.YearView })))

function ViewLoader({ children, viewKey }: { children: JSX.Element; viewKey: ViewType }): JSX.Element {
  const reducedMotion = useReducedMotion()
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={viewKey}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: reducedMotion ? 0 : 0.15 }}
        style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}
      >
        <Suspense fallback={<CalendarSkeleton view={viewKey} />}>
          {children}
        </Suspense>
      </motion.div>
    </AnimatePresence>
  )
}

const VIEW_ORDER: ViewType[] = ['month', 'year', 'week', '3day', 'day', 'agenda', 'todo', 'journal', 'contacts']

function useViewManager(): void {
  const navigate = useNavigate()
  const location = useLocation()
  const currentView = useCalendarStore((state) => state.currentView)
  const setCurrentView = useCalendarStore((state) => state.setCurrentView)
  const isMobile = useIsMobile()

  const isMounted = useRef(false)
  const lastUrlView = useRef<ViewType | null>(null)
  const currentViewRef = useRef(currentView)

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

  const isCalendarRoute = VIEW_ORDER.some((view) => location.pathname === VIEW_ROUTES[view])
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

      let newView: ViewType | null = null
      if (e.key === '<' || e.key === ',') {
        e.preventDefault()
        const currentIndex = VIEW_ORDER.indexOf(currentViewRef.current)
        const prevIndex = (currentIndex - 1 + VIEW_ORDER.length) % VIEW_ORDER.length
        newView = VIEW_ORDER[prevIndex]
      } else if (e.key === '>' || e.key === '.') {
        e.preventDefault()
        const currentIndex = VIEW_ORDER.indexOf(currentViewRef.current)
        const nextIndex = (currentIndex + 1) % VIEW_ORDER.length
        newView = VIEW_ORDER[nextIndex]
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
  const currentView = useCalendarStore((state) => state.currentView)
  const setOverlayOpen = useCalendarStore((state) => state.setOverlayOpen)
  const setShowAddCalendar = useCalendarStore((state) => state.setShowAddCalendar)
  const openModal = useCalendarStore((state) => state.openModal)
  const isJournalModalOpen = useCalendarStore((state) => state.isJournalModalOpen)
  const journalModalDate = useCalendarStore((state) => state.journalModalDate)
  const journalStartInCompose = useCalendarStore((state) => state.journalStartInCompose)
  const closeJournalModal = useCalendarStore((state) => state.closeJournalModal)
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false)
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

  // Fire event/task reminders (web: polling + Notification API; native:
  // real OS-scheduled notifications). Was defined but never mounted anywhere
  // in the app — reminders have never actually fired, on web or native.
  useNotifications()

  useViewManager()

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
  const switchViewBy = useCallback(
    (direction: 'left' | 'right') => {
      const currentIndex = VIEW_ORDER.indexOf(currentViewRef.current)
      const delta = direction === 'left' ? 1 : -1
      const nextIndex = (currentIndex + delta + VIEW_ORDER.length) % VIEW_ORDER.length
      const newView = VIEW_ORDER[nextIndex]
      useCalendarStore.getState().setCurrentView(newView)
      navigate(VIEW_ROUTES[newView], { replace: true })
    },
    [navigate]
  )
  useTwoFingerSwipe(mainRef, { onSwipe: switchViewBy, enabled: isMobile })

  // Mobile: single-finger horizontal swipe on the content area pages the
  // current view's date by one unit (month/week/day/year, matching the
  // header's chevron navigation). Views without date paging (todo/journal/
  // contacts) no-op.
  const handleContentPanEnd = useCallback(
    (_event: PointerEvent, info: PanInfo) => {
      if (!isMobile) return
      const view = currentViewRef.current
      if (view === 'todo' || view === 'journal' || view === 'contacts') return

      const passedDistance = Math.abs(info.offset.x) > 60
      const passedVelocity = Math.abs(info.velocity.x) > 500
      if (!passedDistance && !passedVelocity) return

      const direction: 'prev' | 'next' = info.offset.x < 0 ? 'next' : 'prev'
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
      if (isCommandPaletteOpen || isShortcutsHelpOpen || isJournalModalOpen || useCalendarStore.getState().isModalOpen) {
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
    return <ErrorBoundary key={currentView}><ViewLoader viewKey={currentView}>{viewElement}</ViewLoader></ErrorBoundary>
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
          <Sidebar isOpen={isSidebarOpen} onClose={handleCloseSidebar} isCollapsed={sidebarCollapsed} onCollapsedChange={(v) => updateSettings({ sidebarCollapsed: v })} />
        </ErrorBoundary>
        <motion.main
          className="main"
          ref={mainRef}
          data-view={currentView}
          onPanEnd={isMobile ? handleContentPanEnd : undefined}
        >
          {renderView()}
        </motion.main>
        <AnimatePresence>
          {agendaSidebarOpen && (
            <motion.aside
              className="agendaSidebar"
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: agendaSidebarWidth, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
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
            </motion.aside>
          )}
        </AnimatePresence>
      </div>
      <FloatingNavPill onToggleSidebar={handleToggleSidebar} onOpenSearch={handleOpenCommandPalette} />
      <ErrorBoundary fallback={null}>
        <EventModal />
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
      <CommandPalette
        isOpen={isCommandPaletteOpen}
        onClose={() => {
          setIsCommandPaletteOpen(false)
          setOverlayOpen(false)
        }}
        toggleSidebar={handleToggleSidebar}
        sidebarOpen={window.innerWidth <= 950 ? isSidebarOpen : !sidebarCollapsed}
      />
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

  // Load self-hosted config on mount
  useEffect(() => {
    loadConfigFile()
  }, [loadConfigFile])

  return (
    <BrowserRouter>
      <ThemeProvider>
        <GitHubPagesRedirect />
        <ThemedToaster />
        <CookieConsent />
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
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/privacy" element={<PrivacyPolicy />} />
          <Route path="/setup" element={<SetupPage />} />
        </Routes>
      </ThemeProvider>
    </BrowserRouter>
  )
}

function ThemedToaster(): JSX.Element {
  const { effectiveMode } = useTheme()
  return <Toaster theme={effectiveMode} richColors position="bottom-right" duration={5000} />
}

export default App
