import type { JSX } from 'react'
import { useCallback, useEffect, useState, useRef } from 'react'
import { BrowserRouter, Routes, Route, useNavigate, useLocation } from 'react-router-dom'
import { useCalendarStore } from './store/calendarStore'
import { useSettingsStore } from './store/settingsStore'
import {
  CalendarHeader,
  CalendarGrid,
  WeekView,
  DayView,
  AgendaView,
  TodoView,
  EventModal,
  Sidebar,
} from './features/calendar'
import { SettingsPage, PrivacyPolicy } from './features/settings'
import { CommandPalette } from './features/commandPalette'
import { CookieConsent, ErrorBoundary } from './components/common'
import { OnboardingModal } from './features/onboarding/OnboardingModal'
import { ThemeProvider } from './components/ThemeProvider'
import type { ViewType } from './types'
import './App.css'

const VIEW_ROUTES: Record<ViewType, string> = {
  month: '/month',
  week: '/week',
  day: '/day',
  agenda: '/agenda',
  todo: '/todo',
}

const VIEW_ORDER: ViewType[] = ['month', 'week', 'day', 'agenda', 'todo']

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
  const setOverlayOpen = useCalendarStore((state) => state.setOverlayOpen)
  const setShowAddCalendar = useCalendarStore((state) => state.setShowAddCalendar)
  const openModal = useCalendarStore((state) => state.openModal)
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false)
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const [isFabMenuOpen, setIsFabMenuOpen] = useState(false)

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
      case 'todo':
        return (
          <ErrorBoundary>
            <TodoView />
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

  const handleToggleSidebar = useCallback(() => {
    setIsSidebarOpen((prev) => !prev)
  }, [])

  const handleCloseSidebar = useCallback(() => {
    setIsSidebarOpen(false)
  }, [])

  const handleOpenCommandPalette = useCallback(() => {
    setIsCommandPaletteOpen(true)
    setOverlayOpen(true)
  }, [setOverlayOpen])

  const handleFabAction = useCallback(
    (action: 'event' | 'task' | 'command') => {
      setIsFabMenuOpen(false)
      if (action === 'command') {
        handleOpenCommandPalette()
      } else {
        openModal(undefined, undefined, undefined, action)
      }
    },
    [openModal, handleOpenCommandPalette]
  )

  return (
    <div className="app">
      <CalendarHeader
        onToggleSidebar={handleToggleSidebar}
        onOpenCommandPalette={handleOpenCommandPalette}
      />
      <div className="appContent">
        <Sidebar isOpen={isSidebarOpen} onClose={handleCloseSidebar} />
        <main className="main">{renderView()}</main>
      </div>
      <MobileFAB
        onClick={() => setIsFabMenuOpen(!isFabMenuOpen)}
        isOpen={isFabMenuOpen}
        onAction={handleFabAction}
      />
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

interface MobileFABProps {
  onClick: () => void
  isOpen: boolean
  onAction: (action: 'event' | 'task' | 'command') => void
}

function MobileFAB({ onClick, isOpen, onAction }: MobileFABProps): JSX.Element {
  return (
    <>
      <button className="mobile-fab" onClick={onClick} aria-label="Quick actions">
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M12 5V19M5 12H19"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {isOpen && (
        <div className="mobile-fab-menu">
          <button className="mobile-fab-option" onClick={() => onAction('command')}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path
                d="M18 3a3 3 0 00-3 3v12a3 3 0 003 3 3 3 0 003-3V6a3 3 0 00-3-3 3 3 0 00-3 3v12a3 3 0 003 3 3 3 0 003-3V6a3 3 0 00-3-3z"
                stroke="currentColor"
                strokeWidth="2"
              />
            </svg>
            Command Palette
          </button>
          <button className="mobile-fab-option" onClick={() => onAction('event')}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <rect
                x="3"
                y="4"
                width="18"
                height="18"
                rx="2"
                stroke="currentColor"
                strokeWidth="2"
              />
              <path
                d="M16 2v4M8 2v4M3 10h18"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
            Create Event
          </button>
          <button className="mobile-fab-option" onClick={() => onAction('task')}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path
                d="M9 11l3 3L22 4"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
            Create Task
          </button>
        </div>
      )}
    </>
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
