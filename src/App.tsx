import type { JSX } from 'react'
import { useState, useCallback } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { motion } from 'framer-motion'
import { v4 as uuidv4 } from 'uuid'
import { useCalendarStore } from './store/calendarStore'
import {
  CalendarHeader,
  CalendarGrid,
  WeekView,
  DayView,
  AgendaView,
  EventModal,
  Sidebar,
} from './features/calendar'
import { QuickAdd, type NLPParseResult } from './features/nlp'
import { SettingsPage } from './features/settings'
import type { CalendarEvent } from './types'
import './App.css'

function CalendarApp(): JSX.Element {
  const currentView = useCalendarStore((state) => state.currentView)
  const addEvent = useCalendarStore((state) => state.addEvent)
  const calendars = useCalendarStore((state) => state.calendars)
  const [isQuickAddOpen, setIsQuickAddOpen] = useState(false)

  const renderView = (): JSX.Element => {
    switch (currentView) {
      case 'month':
        return <CalendarGrid />
      case 'week':
        return <WeekView />
      case 'day':
        return <DayView />
      case 'agenda':
        return <AgendaView />
      default:
        return <CalendarGrid />
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
      setIsQuickAddOpen(false)
    },
    [addEvent, calendars]
  )

  const handleToggleQuickAdd = useCallback(() => {
    setIsQuickAddOpen((prev) => !prev)
  }, [])

  return (
    <div className="app">
      <CalendarHeader onQuickAdd={handleToggleQuickAdd} />
      <div className="appContent">
        <Sidebar />
        <main className="main">
          {isQuickAddOpen && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
            >
              <QuickAdd onAdd={handleQuickAdd} onCancel={() => setIsQuickAddOpen(false)} />
            </motion.div>
          )}
          {renderView()}
        </main>
      </div>
      <EventModal />
    </div>
  )
}

function App(): JSX.Element {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<CalendarApp />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
