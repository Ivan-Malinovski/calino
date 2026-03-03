import type { JSX } from 'react'
import { useCallback, useEffect, useState, useRef } from 'react'
import { BrowserRouter, Routes, Route, useNavigate, useLocation } from 'react-router-dom'
import { v4 as uuidv4 } from 'uuid'
import { useCalendarStore } from './store/calendarStore'
import { useSettingsStore } from './store/settingsStore'
import {
  CalendarHeader,
  CalendarGrid,
  WeekView,
  DayView,
  AgendaView,
  EventModal,
  Sidebar,
} from './features/calendar'
import { type NLPParseResult } from './features/nlp'
import { SettingsPage, PrivacyPolicy } from './features/settings'
import { CommandPalette } from './features/commandPalette'
import { CookieConsent, ErrorBoundary } from './components/common'
import { OnboardingModal } from './features/onboarding/OnboardingModal'
import { ThemeProvider } from './components/ThemeProvider'
import type { CalendarEvent, ViewType } from './types'
import './App.css'

const VIEW_ROUTES: Record<ViewType, string> = {
  month: '/month',
  week: '/week',
  day: '/day',
  agenda: '/agenda',
}

const VIEW_ORDER: ViewType[] = ['month', 'week', 'day', 'agenda']

function Toast(): JSX.Element | null {
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    const handleShowToast = (e: CustomEvent) => {
      setMessage(e.detail.message)
      setTimeout(() => setMessage(null), 2000)
    }

    window.addEventListener('show-toast', handleShowToast as EventListener)
    return () => window.removeEventListener('show-toast', handleShowToast as EventListener)
  }, [])

  if (!message) return null

  return (
    <div className="toast">
      <span className="toastIcon">✓</span>
      {message}
    </div>
  )
}

function useViewManager(): void {
  const navigate = useNavigate()
  const location = useLocation()
  const currentView = useCalendarStore((state) => state.currentView)
  const setCurrentView = useCalendarStore((state) => state.setCurrentView)
  const defaultView = useSettingsStore((state) => state.defaultView)

  const isMounted = useRef(false)
  const prevPath = useRef<string>(location.pathname)

  useEffect(() => {
    isMounted.current = true
  }, [])

  const isCalendarRoute = VIEW_ORDER.some((view) => location.pathname === VIEW_ROUTES[view])
  const isRootRoute = location.pathname === '/'

  useEffect(() => {
    if (!isMounted.current) return
    if (!isCalendarRoute && !isRootRoute) return
    const path = location.pathname === '/' ? '' : location.pathname.slice(1)
    const view = (path as ViewType) || defaultView
    if (VIEW_ORDER.includes(view)) {
      setCurrentView(view)
    }
  }, [location.pathname, defaultView, setCurrentView, isCalendarRoute, isRootRoute])

  useEffect(() => {
    if (!isMounted.current) return
    if (!isCalendarRoute && !isRootRoute) return

    // Don't navigate if path hasn't actually changed (prevents loops)
    if (location.pathname === prevPath.current) return
    prevPath.current = location.pathname

    const targetPath = VIEW_ROUTES[currentView]
    if (location.pathname !== targetPath) {
      navigate(targetPath, { replace: true })
    }
  }, [currentView, location.pathname, navigate, isCalendarRoute, isRootRoute])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return
      }

      if (e.key === '<' || e.key === ',') {
        e.preventDefault()
        const currentIndex = VIEW_ORDER.indexOf(currentView)
        const prevIndex = (currentIndex - 1 + VIEW_ORDER.length) % VIEW_ORDER.length
        setCurrentView(VIEW_ORDER[prevIndex])
      } else if (e.key === '>' || e.key === '.') {
        e.preventDefault()
        const currentIndex = VIEW_ORDER.indexOf(currentView)
        const nextIndex = (currentIndex + 1) % VIEW_ORDER.length
        setCurrentView(VIEW_ORDER[nextIndex])
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [currentView, setCurrentView])
}

function CalendarApp(): JSX.Element {
  const currentView = useCalendarStore((state) => state.currentView)
  const addEvent = useCalendarStore((state) => state.addEvent)
  const calendars = useCalendarStore((state) => state.calendars)
  const setOverlayOpen = useCalendarStore((state) => state.setOverlayOpen)
  const setShowAddCalendar = useCalendarStore((state) => state.setShowAddCalendar)
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false)

  useViewManager()

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setIsCommandPaletteOpen(true)
        setOverlayOpen(true)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [setOverlayOpen])

  const renderView = (): JSX.Element => {
    switch (currentView) {
      case 'month':
        return (
          <ErrorBoundary>
            <CalendarGrid />
          </ErrorBoundary>
        )
      case 'week':
        return (
          <ErrorBoundary>
            <WeekView />
          </ErrorBoundary>
        )
      case 'day':
        return (
          <ErrorBoundary>
            <DayView />
          </ErrorBoundary>
        )
      case 'agenda':
        return (
          <ErrorBoundary>
            <AgendaView />
          </ErrorBoundary>
        )
      default:
        return (
          <ErrorBoundary>
            <CalendarGrid />
          </ErrorBoundary>
        )
    }
  }

  const handleQuickAdd = useCallback(
    (result: NLPParseResult): void => {
      const defaultCalendar = calendars.find((c) => c.isDefault) || calendars[0]

      const event: CalendarEvent = {
        id: uuidv4(),
        calendarId: defaultCalendar?.id || 'default',
        title: result.title,
        location: result.location,
        start: result.startDate.toISOString(),
        end: result.endDate ? result.endDate.toISOString() : result.startDate.toISOString(),
        isAllDay: result.isAllDay,
        recurrence: result.recurrence,
      }

      addEvent(event)
    },
    [addEvent, calendars]
  )

  return (
    <div className="app">
      <CalendarHeader onQuickAdd={handleQuickAdd} />
      <div className="appContent">
        <Sidebar />
        <main className="main">{renderView()}</main>
      </div>
      <EventModal />
      <CommandPalette
        isOpen={isCommandPaletteOpen}
        onClose={() => {
          setIsCommandPaletteOpen(false)
          setOverlayOpen(false)
        }}
      />
      <OnboardingModal onAddCalendar={() => setShowAddCalendar(true)} />
    </div>
  )
}

function App(): JSX.Element {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <Toast />
        <CookieConsent />
        <Routes>
          <Route path="/month" element={<CalendarApp />} />
          <Route path="/week" element={<CalendarApp />} />
          <Route path="/day" element={<CalendarApp />} />
          <Route path="/agenda" element={<CalendarApp />} />
          <Route path="/" element={<CalendarApp />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/privacy" element={<PrivacyPolicy />} />
        </Routes>
      </ThemeProvider>
    </BrowserRouter>
  )
}

export default App
