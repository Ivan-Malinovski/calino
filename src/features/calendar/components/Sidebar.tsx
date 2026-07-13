import type { JSX } from 'react'
import { useMemo, useState, useRef, useEffect, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { useReducedMotion } from '@/hooks/useReducedMotion'
import { ContextMenu } from '@/components/common/ContextMenu'
import {
  format,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isSameMonth,
  isSameDay,
  isToday,
  addMonths,
  subMonths,
  parseISO,
} from 'date-fns'
import { CALENDAR_COLORS, config, TOAST_DURATION_MS } from '@/config'
import { useCalendarStore } from '@/store/calendarStore'
import { useSettingsStore } from '@/store/settingsStore'
import { useCalDAVSyncStore } from '@/store/caldavSyncStore'
import { useCalDAV } from '@/features/caldav/hooks/useCalDAV'
import { useUpdateCheck } from '@/hooks/useUpdateCheck'
import { showToast } from '@/lib/toast'
import { AddCalendarModal } from './AddCalendarModal'
import { SubscribeCalendarModal } from './SubscribeCalendarModal'
import { CreateCalendarModal } from './CreateCalendarModal'
import { DeleteCalendarDialog } from './DeleteCalendarDialog'
import { EmptyState } from '@/components/common/EmptyState'
import { MiniTasksSection } from './MiniTasksSection'
import styles from './Sidebar.module.css'

let hasAutoSyncedCalendars = false
const CALENDAR_COLOR_PRESETS = [...CALENDAR_COLORS.slice(0, 4), '#7B1FA2']

interface SidebarProps {
  isOpen?: boolean
  onClose?: () => void
  isCollapsed?: boolean
  onCollapsedChange?: (collapsed: boolean) => void
}

export function Sidebar({ isOpen = false, onClose, isCollapsed: controlledCollapsed, onCollapsedChange }: SidebarProps): JSX.Element {
  const prefersReducedMotion = useReducedMotion()
  const [internalCollapsed, setInternalCollapsed] = useState(false)
  const isCollapsed = controlledCollapsed ?? internalCollapsed
  const setIsCollapsed = onCollapsedChange ?? setInternalCollapsed
  const [isCompact, setIsCompact] = useState(
    typeof window !== 'undefined' ? window.innerWidth <= 950 : false
  )
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [showYearDropdown, setShowYearDropdown] = useState(false)
  const [showMonthDropdown, setShowMonthDropdown] = useState(false)
  const [miniDate, setMiniDate] = useState<Date | null>(null)
  const [miniDateInitialized, setMiniDateInitialized] = useState(false)
  const showYearDropdownRef = useRef(showYearDropdown)
  const showMonthDropdownRef = useRef(showMonthDropdown)
  const [isTasksExpanded, setIsTasksExpanded] = useState(false)
  const hasInitializedTasksExpandedRef = useRef(false)
  const syncAllRequestRef = useRef<Promise<void> | null>(null)
  const [isCalendarsExpanded, setIsCalendarsExpanded] = useState(false)
  const [isCategoriesExpanded, setIsCategoriesExpanded] = useState(false)
  const [colorPickerCalendarId, setColorPickerCalendarId] = useState<string | null>(null)
  const [syncingCalendarId, setSyncingCalendarId] = useState<string | null>(null)
  const [isSyncingAll, setIsSyncingAll] = useState(false)
  const [syncStatus, setSyncStatus] = useState<Record<string, 'success' | 'error'>>({})
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    calendarId: string
  } | null>(null)
  const [showSubscribeCalendar, setShowSubscribeCalendar] = useState(false)
  const [addCalendarMenu, setAddCalendarMenu] = useState<{ x: number; y: number } | null>(null)
  const [showCreateCalendar, setShowCreateCalendar] = useState(false)
  const [createCalendarAccountId, setCreateCalendarAccountId] = useState<string | null>(null)
  const [showDeleteCalendar, setShowDeleteCalendar] = useState(false)
  const [deleteCalendarId, setDeleteCalendarId] = useState<string | null>(null)
  const [deleteCalendarName, setDeleteCalendarName] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const colorPickerRef = useRef<HTMLDivElement>(null)
  const currentDate = useCalendarStore((state) => state.currentDate)
  const setCurrentDate = useCalendarStore((state) => state.setCurrentDate)
  const calendars = useCalendarStore((state) => state.calendars)
  const categories = useCalendarStore((state) => state.categories)
  const selectedCategoryIds = useCalendarStore((state) => state.selectedCategoryIds)
  const toggleCategoryFilter = useCalendarStore((state) => state.toggleCategoryFilter)
  const toggleCalendarVisibility = useCalendarStore((state) => state.toggleCalendarVisibility)
  const updateCalendar = useCalendarStore((state) => state.updateCalendar)
  const deleteCalendar = useCalendarStore((state) => state.deleteCalendar)
  const useCategoryColors = useSettingsStore((state) => state.useCategoryColors)
  const updateSettings = useSettingsStore((state) => state.updateSettings)
  const sidebarWidth = useSettingsStore((state) => state.sidebarWidth)
  const firstDayOfWeek = useSettingsStore((state) => state.firstDayOfWeek)
  const hideCompletedTasksInMonthView = useSettingsStore((state) => state.hideCompletedTasksInMonthView)
  const showAddCalendar = useCalendarStore((state) => state.showAddCalendar)
  const setShowAddCalendar = useCalendarStore((state) => state.setShowAddCalendar)
  const globalSyncStatus = useCalDAVSyncStore((state) => state.status)
  const { accounts, syncAccount, syncState, updateCalendar: updateCalDAVCalendar, deleteCalendarFromServer } = useCalDAV()
  const navigate = useNavigate()

  const accountIds = useMemo(
    () => [
      ...new Set([
        ...accounts.map((account) => account.id),
        ...calendars.flatMap((calendar) => calendar.accountId ?? []),
      ]),
    ],
    [accounts, calendars]
  )

  const syncAllAccounts = useCallback(async (): Promise<void> => {
    for (const accountId of accountIds) {
      await syncAccount(accountId)
    }
  }, [accountIds, syncAccount])

  const runSyncAll = useCallback((): Promise<void> => {
    if (syncAllRequestRef.current) return syncAllRequestRef.current
    const request = syncAllAccounts().finally(() => {
      syncAllRequestRef.current = null
    })
    syncAllRequestRef.current = request
    return request
  }, [syncAllAccounts])

  const handleSyncAll = async (): Promise<void> => {
    if (accountIds.length === 0 || isSyncingAll) return
    if (globalSyncStatus === 'syncing') {
      showToast('Calendars are already syncing.')
      return
    }
    // A manual request made before the mount effect runs becomes the initial
    // sync, avoiding a duplicate request for the same accounts.
    hasAutoSyncedCalendars = true
    setIsSyncingAll(true)
    try {
      await runSyncAll()
      showToast('All calendars synced.')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Failed to sync calendars')
    } finally {
      setIsSyncingAll(false)
    }
  }

  useEffect(() => {
    if (hasAutoSyncedCalendars || accountIds.length === 0) return
    hasAutoSyncedCalendars = true
    runSyncAll().catch((error) => {
      console.warn('[CalDAV] Automatic calendar sync failed:', error)
    })
  }, [accountIds.length, runSyncAll])

  // Initialize miniDate from the store on first render
  useEffect(() => {
    if (!miniDateInitialized) {
      setMiniDate(parseISO(currentDate))
      setMiniDateInitialized(true)
    }
  }, [currentDate, miniDateInitialized])

  useEffect(() => {
    if (!hasInitializedTasksExpandedRef.current) {
      const events = useCalendarStore.getState().events
      if (events.length > 0) {
        setIsTasksExpanded(events.some((e) => e.type === 'task' && !e.completed))
        hasInitializedTasksExpandedRef.current = true
      }
    }
  })

  const effectiveMiniDate = miniDate ?? parseISO(currentDate)

  const handleSyncCalendar = async (calendarId: string, accountId?: string): Promise<void> => {
    if (!accountId || syncingCalendarId) return
    setSyncingCalendarId(calendarId)
    setSyncStatus((prev) => {
      const { [calendarId]: _, ...rest } = prev // eslint-disable-line @typescript-eslint/no-unused-vars
      return rest
    })
    try {
      await syncAccount(accountId)
      setSyncStatus((prev) => ({ ...prev, [calendarId]: 'success' }))
      setTimeout(() => {
        setSyncStatus((prev) => {
          const { [calendarId]: _, ...rest } = prev // eslint-disable-line @typescript-eslint/no-unused-vars
          return rest
        })
      }, TOAST_DURATION_MS)
    } catch {
      setSyncStatus((prev) => ({ ...prev, [calendarId]: 'error' }))
      setTimeout(() => {
        setSyncStatus((prev) => {
          const { [calendarId]: _, ...rest } = prev // eslint-disable-line @typescript-eslint/no-unused-vars
          return rest
        })
      }, 3000)
    } finally {
      setSyncingCalendarId(null)
    }
  }

  const handleContextMenu = (e: React.MouseEvent, calendarId: string): void => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, calendarId })
  }

  const closeContextMenu = (): void => {
    setContextMenu(null)
  }

  const currentYear = new Date().getFullYear()
  const years = Array.from({ length: 11 }, (_, i) => currentYear - 5 + i)
  const months = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ]

  const handleMonthClick = (): void => {
    setShowMonthDropdown(!showMonthDropdown)
  }

  const handleMonthSelect = (monthIndex: number): void => {
    const newDate = new Date(effectiveMiniDate.getFullYear(), monthIndex, 1)
    setMiniDate(newDate)
    setShowMonthDropdown(false)
  }

  const handleYearClick = (): void => {
    setShowYearDropdown(!showYearDropdown)
  }

  const handleYearSelect = (year: number): void => {
    const newDate = new Date(effectiveMiniDate.getFullYear(), effectiveMiniDate.getMonth(), 1)
    newDate.setFullYear(year)
    setMiniDate(newDate)
    setShowYearDropdown(false)
  }

  useEffect(() => {
    showYearDropdownRef.current = showYearDropdown
  }, [showYearDropdown])

  useEffect(() => {
    showMonthDropdownRef.current = showMonthDropdown
  }, [showMonthDropdown])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent): void => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowYearDropdown(false)
        setShowMonthDropdown(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleStartRename = (id: string, name: string): void => {
    setEditingId(id)
    setEditName(name)
    setTimeout(() => inputRef.current?.select(), 0)
  }

  const handleFinishRename = async (): Promise<void> => {
    if (editingId && editName.trim()) {
      const newName = editName.trim()
      const calendar = calendars.find((c) => c.id === editingId)

      // The local rename is authoritative and persists immediately (same as
      // color changes). We don't roll it back when the server push fails —
      // reverting the name the user just typed is hostile, and many CalDAV
      // servers reject displayname PROPPATCH outright.
      updateCalendar(editingId, { name: newName })

      // Best-effort: push the new name to the CalDAV server. On failure keep
      // the local rename and just surface the problem.
      if (calendar?.accountId) {
        try {
          await updateCalDAVCalendar(editingId, { name: newName })
        } catch (error) {
          const detail = error instanceof Error ? error.message : 'unknown error'
          showToast(`Renamed locally, but the server update failed: ${detail}`)
        }
      }
    }
    setEditingId(null)
    setEditName('')
  }

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter') {
      handleFinishRename()
    } else if (e.key === 'Escape') {
      setEditingId(null)
      setEditName('')
    }
  }

  const handleColorChange = async (calendarId: string, color: string): Promise<void> => {
    const calendar = calendars.find((item) => item.id === calendarId)
    updateCalendar(calendarId, { color })
    setColorPickerCalendarId(null)

    if (calendar?.accountId) {
      try {
        await updateCalDAVCalendar(calendarId, { color })
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'unknown error'
        showToast(`Color changed locally, but the server update failed: ${detail}`)
      }
    }
  }

  useEffect(() => {
    if (!colorPickerCalendarId) return

    const handlePointerDown = (event: PointerEvent): void => {
      if (!colorPickerRef.current?.contains(event.target as Node)) {
        setColorPickerCalendarId(null)
      }
    }
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setColorPickerCalendarId(null)
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [colorPickerCalendarId])

  const [isResizing, setIsResizing] = useState(false)
  const COLLAPSE_THRESHOLD = 255

  const handleSidebarResizeStart = useCallback((e: React.MouseEvent): void => {
    e.preventDefault()
    setIsResizing(true)
    const startX = e.clientX
    const startWidth = sidebarWidth
    const onMove = (ev: MouseEvent): void => {
      const delta = ev.clientX - startX
      const newWidth = Math.min(500, startWidth + delta)
      if (newWidth < COLLAPSE_THRESHOLD) {
        setIsCollapsed(true)
        document.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseup', onUp)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        setIsResizing(false)
        return
      }
      updateSettings({ sidebarWidth: newWidth })
    }
    const onUp = (): void => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      setIsResizing(false)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [sidebarWidth, updateSettings])

  // Auto-collapse if stored width is below threshold
  useEffect(() => {
    if (sidebarWidth < COLLAPSE_THRESHOLD && !isCollapsed) {
      setIsCollapsed(true)
    }
  }, [sidebarWidth, isCollapsed])

  const miniCalendarDays = useMemo(() => {
    const monthStart = startOfMonth(effectiveMiniDate)
    const monthEnd = endOfMonth(effectiveMiniDate)
    const calendarStart = startOfWeek(monthStart, { weekStartsOn: firstDayOfWeek })
    const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: firstDayOfWeek })
    return eachDayOfInterval({ start: calendarStart, end: calendarEnd })
  }, [effectiveMiniDate, firstDayOfWeek])

  const weekdays = useMemo(() => {
    const days = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
    const idx = firstDayOfWeek || 0
    return [...days.slice(idx), ...days.slice(0, idx)]
  }, [firstDayOfWeek])

  const handlePrevMonth = (): void => {
    setMiniDate(subMonths(effectiveMiniDate, 1))
  }

  const handleNextMonth = (): void => {
    setMiniDate(addMonths(effectiveMiniDate, 1))
  }

  const handleDayClick = (day: Date): void => {
    setCurrentDate(format(day, 'yyyy-MM-dd'))
    setMiniDate(day)
  }

  const handleDayDoubleClick = (day: Date): void => {
    setCurrentDate(format(day, 'yyyy-MM-dd'))
    setMiniDate(day)
    navigate('/day')
  }

  const handleToday = (): void => {
    const today = new Date()
    setCurrentDate(format(today, 'yyyy-MM-dd'))
    setMiniDate(today)
  }

  useEffect(() => {
    if (isOpen && onClose) {
      const handleResize = (): void => {
        if (window.innerWidth > 950) {
          onClose()
        }
      }
      window.addEventListener('resize', handleResize)
      return () => window.removeEventListener('resize', handleResize)
    }
  }, [isOpen, onClose])

  useEffect(() => {
    const check = (): void => setIsCompact(window.innerWidth <= 950)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  const sidebarClass = `${styles.sidebar}${isOpen ? ` ${styles.open}` : ''}${isCollapsed && !isCompact ? ` ${styles.sidebarCollapsed}` : ''}${isResizing ? ` ${styles.resizing}` : ''}`

  return (
    <>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            className={styles.overlay}
            onClick={onClose}
            initial={prefersReducedMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0 }}
            transition={{ duration: prefersReducedMotion ? 0 : 0.2 }}
          />
        )}
      </AnimatePresence>
      <div
        className={sidebarClass}
        style={{
          width: isCollapsed && !isCompact ? undefined : sidebarWidth,
          minWidth: isCollapsed && !isCompact ? undefined : sidebarWidth,
        }}
        data-component="sidebar"
      >
        {/* Sidebar content — hidden when collapsed via CSS */}
        <div className={styles.sidebarContent}>
          {isOpen && (
            <div className={styles.sidebarBrand}>
              <div className={styles.sidebarBrandDiamond} />
              <span className={styles.sidebarBrandName}>Calino</span>
            </div>
          )}
        <div className={styles.miniCalendar}>
          <div className={styles.miniHeader}>
            <button onClick={handlePrevMonth} className={styles.miniNavBtn} aria-label="Previous month">
              <ChevronLeft />
            </button>
            <div style={{ position: 'relative' }} ref={dropdownRef}>
              <span className={styles.miniMonth}>
                <button onClick={handleMonthClick} className={styles.miniMonthButton}>
                  {format(effectiveMiniDate, 'MMMM')}
                </button>
                {showMonthDropdown && (
                  <div className={styles.yearDropdown}>
                    {months.map((month, index) => (
                      <button
                        key={month}
                        onClick={() => handleMonthSelect(index)}
                        className={`${styles.yearOption} ${
                          index === effectiveMiniDate.getMonth() ? styles.yearOptionSelected : ''
                        }`}
                      >
                        {month}
                      </button>
                    ))}
                  </div>
                )}
                <button onClick={handleYearClick} className={styles.miniMonthButton}>
                  {format(effectiveMiniDate, 'yyyy')}
                </button>
                {showYearDropdown && (
                  <div className={`${styles.yearDropdown} ${styles.yearDropdownRight}`}>
                    {years.map((year) => (
                      <button
                        key={year}
                        onClick={() => handleYearSelect(year)}
                        className={`${styles.yearOption} ${
                          year === effectiveMiniDate.getFullYear() ? styles.yearOptionSelected : ''
                        }`}
                      >
                        {year}
                      </button>
                    ))}
                  </div>
                )}
              </span>
            </div>
            <button onClick={handleNextMonth} className={styles.miniNavBtn} aria-label="Next month">
              <ChevronRight />
            </button>
          </div>
          <div className={styles.miniWeekdays}>
            {weekdays.map((day, idx) => (
              <span key={idx} className={styles.miniWeekday}>
                {day}
              </span>
            ))}
          </div>
          <div className={styles.miniDays}>
            {miniCalendarDays.map((day) => {
              const isCurrentMonth = isSameMonth(day, effectiveMiniDate)
              const isSelected = isSameDay(day, parseISO(currentDate))
              const isTodayDate = isToday(day)
              return (
                <button
                  key={day.toISOString()}
                  className={`${styles.miniDay} ${!isCurrentMonth ? styles.otherMonth : ''} ${
                    isSelected ? styles.selected : ''
                  } ${isTodayDate ? styles.today : ''}`}
                  onClick={() => handleDayClick(day)}
                  onDoubleClick={() => handleDayDoubleClick(day)}
                >
                  {format(day, 'd')}
                </button>
              )
            })}
          </div>
          <button className={styles.todayBtn} onClick={handleToday} data-component="sidebar-today-button">
            Today
          </button>
        </div>

        <div className={styles.calendars}>
          <div className={styles.sectionTitleRow}>
            <button
              type="button"
              className={`${styles.sectionHeader} ${styles.calendarSectionToggle}`}
              onClick={() => setIsCalendarsExpanded(!isCalendarsExpanded)}
              aria-expanded={isCalendarsExpanded}
              aria-controls="sidebar-calendars"
              data-component="calendar-section-toggle"
            >
              <span className={styles.sectionTitle}>Calendars</span>
              {calendars.length > 0 && (
                <span className={styles.sectionCount}>
                  {calendars.filter((calendar) => calendar.isVisible).length}/{calendars.length}
                </span>
              )}
              <ChevronDown className={`${styles.chevron} ${isCalendarsExpanded ? styles.chevronExpanded : ''}`} />
            </button>
            <div className={styles.calendarHeaderActions}>
              <button
                className={`${styles.addCalendarButton} ${isSyncingAll || globalSyncStatus === 'syncing' ? styles.headerSyncing : ''}`}
                onClick={handleSyncAll}
                title="Sync all calendars"
                aria-label="Sync all calendars"
                data-component="sync-all-calendars"
                disabled={
                  accountIds.length === 0 ||
                  isSyncingAll
                }
              >
                <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M23 4v6h-6M1 20v-6h6" />
                  <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
                </svg>
              </button>
              <button
                className={styles.addCalendarButton}
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect()
                  setAddCalendarMenu({ x: rect.left, y: rect.bottom + 4 })
                }}
                title="Add calendar"
                aria-label="Add calendar"
              >
                <PlusIcon />
              </button>
            </div>
          </div>
          <AnimatePresence initial={false}>
            {isCalendarsExpanded && (
              <motion.div
                id="sidebar-calendars"
                initial={prefersReducedMotion ? false : { opacity: 0, y: -5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: -5 }}
                transition={{ duration: prefersReducedMotion ? 0 : 0.15 }}
                className={styles.calendarList}
              >
                {calendars.length === 0 && (
                  <EmptyState
                    title="No calendars yet"
                    description="Add a CalDAV account to sync events, or continue offline."
                    action={
                      <button
                        className={styles.addCalendarButton}
                        onClick={() => setShowAddCalendar(true)}
                        aria-label="Add a CalDAV account"
                        data-component="sidebar-empty-add"
                      >
                        + Add a CalDAV account
                      </button>
                    }
                  />
                )}
                {calendars.map((calendar) => (
                  <label
                    key={calendar.id}
                    className={styles.calendarItem}
                    onContextMenu={(e) => handleContextMenu(e, calendar.id)}
                  >
                    <input
                      type="checkbox"
                      checked={calendar.isVisible}
                      onChange={() => toggleCalendarVisibility(calendar.id)}
                      className={styles.checkbox}
                    />
                    <div className={styles.colorPicker} ref={colorPickerCalendarId === calendar.id ? colorPickerRef : undefined}>
                      <button
                        type="button"
                        className={styles.colorDot}
                        style={{ backgroundColor: calendar.color }}
                        onClick={(event) => {
                          event.preventDefault()
                          setColorPickerCalendarId((current) => current === calendar.id ? null : calendar.id)
                        }}
                        aria-label={`Change ${calendar.name} color`}
                        aria-expanded={colorPickerCalendarId === calendar.id}
                        aria-controls={`calendar-color-picker-${calendar.id}`}
                      />
                      {colorPickerCalendarId === calendar.id && (
                        <div
                          id={`calendar-color-picker-${calendar.id}`}
                          className={styles.colorPickerMenu}
                          role="group"
                          aria-label={`Color picker for ${calendar.name}`}
                          data-component="calendar-color-picker"
                        >
                          <div className={styles.colorPresets}>
                            {CALENDAR_COLOR_PRESETS.map((color) => (
                              <button
                                key={color}
                                type="button"
                                className={`${styles.colorPreset} ${calendar.color.toLowerCase() === color.toLowerCase() ? styles.colorPresetSelected : ''}`}
                                style={{ backgroundColor: color }}
                                onClick={(event) => {
                                  event.preventDefault()
                                  handleColorChange(calendar.id, color)
                                }}
                                aria-label={`Use ${color} for ${calendar.name}`}
                              />
                            ))}
                            <span
                              className={`${styles.customColorPicker} ${
                                !CALENDAR_COLOR_PRESETS.some(
                                  (preset) => preset.toLowerCase() === calendar.color.toLowerCase()
                                )
                                  ? styles.customColorPickerSelected
                                  : ''
                              }`}
                            >
                              <input
                                type="color"
                                value={calendar.color}
                                onChange={(event) => handleColorChange(calendar.id, event.target.value)}
                                aria-label={`Custom color for ${calendar.name}`}
                              />
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                    {editingId === calendar.id ? (
                      <input
                        ref={inputRef}
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onBlur={handleFinishRename}
                        onKeyDown={handleKeyDown}
                        className={styles.renameInput}
                      />
                    ) : (
                      <span
                        className={styles.calendarName}
                        onDoubleClick={() => handleStartRename(calendar.id, calendar.name)}
                      >
                        {calendar.name}
                      </span>
                    )}
                    {calendar.accountId && (
                      <button
                        className={`${styles.syncButton} ${syncingCalendarId === calendar.id || syncState.status === 'syncing' || globalSyncStatus === 'syncing' ? styles.syncing : ''} ${syncStatus[calendar.id] === 'success' ? styles.success : ''} ${syncStatus[calendar.id] === 'error' ? styles.error : ''}`}
                        onClick={() => handleSyncCalendar(calendar.id, calendar.accountId)}
                        title="Sync calendar"
                        aria-label={`Sync ${calendar.name}`}
                        disabled={!!syncingCalendarId}
                      >
                        {syncStatus[calendar.id] === 'success' ? (
                          <svg aria-hidden="true"
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                          >
                            <path d="M20 6L9 17l-5-5" />
                          </svg>
                        ) : syncStatus[calendar.id] === 'error' ? (
                          <svg aria-hidden="true"
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                          >
                            <path d="M18 6L6 18M6 6l12 12" />
                          </svg>
                        ) : (
                          <svg aria-hidden="true"
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                          >
                            <path d="M23 4v6h-6M1 20v-6h6" />
                            <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
                          </svg>
                        )}
                      </button>
                    )}
                  </label>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <MiniTasksSection
          isExpanded={isTasksExpanded}
          onToggle={() => setIsTasksExpanded(!isTasksExpanded)}
        />

        <div className={styles.stickyBottom}>
          {categories.length > 0 && (
            <div className={styles.categoriesWrapper}>
              <button
                type="button"
                className={styles.sectionHeader}
                onClick={() => setIsCategoriesExpanded(!isCategoriesExpanded)}
                aria-expanded={isCategoriesExpanded}
                aria-controls="sidebar-categories"
                data-component="category-section-toggle"
              >
                <span className={styles.sectionTitle}>Categories</span>
                <ChevronDown className={`${styles.chevron} ${isCategoriesExpanded ? styles.chevronExpanded : ''}`} />
              </button>
              <AnimatePresence>
                {isCategoriesExpanded && (
                  <motion.div
                    id="sidebar-categories"
                    initial={prefersReducedMotion ? false : { opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: 5 }}
                    transition={{ duration: prefersReducedMotion ? 0 : 0.15 }}
                    className={styles.categoryCard}
                  >
                    <div className={styles.categoryCardList}>
                      {categories.map((category) => (
                        <button
                          key={category.id}
                          className={`${styles.categoryItem} ${selectedCategoryIds.includes(category.id) ? styles.categoryItemSelected : ''}`}
                          onClick={() => toggleCategoryFilter(category.id)}
                        >
                          <span className={styles.categoryCheck}>
                            <svg className={styles.categoryCheckSvg} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M2 6l3 3 5-5" />
                            </svg>
                          </span>
                          <span
                            className={styles.categoryDot}
                            style={{ backgroundColor: category.color }}
                          />
                          <span className={styles.categoryName}>{category.name}</span>
                        </button>
                      ))}
                    </div>
                    <div className={styles.categoryToggle}>
                      <span className={styles.categoryToggleLabel}>Use category colors</span>
                      <label className={styles.categoryToggleSwitch}>
                        <input
                          type="checkbox"
                          checked={useCategoryColors}
                          onChange={() => updateSettings({ useCategoryColors: !useCategoryColors })}
                        />
                        <span className={styles.categoryTogglePill} />
                      </label>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}

          <div className={styles.footer}>
            <Link to="/privacy" className={styles.footerLink}>
              Privacy
            </Link>
            <UpdateIndicator />
          </div>
        </div>

        <AddCalendarModal isOpen={showAddCalendar} onClose={() => setShowAddCalendar(false)} />
        <SubscribeCalendarModal
          isOpen={showSubscribeCalendar}
          onClose={() => setShowSubscribeCalendar(false)}
        />
        {addCalendarMenu &&
          createPortal(
            <ContextMenu
              x={addCalendarMenu.x}
              y={addCalendarMenu.y}
              items={[
                {
                  label: 'Add CalDAV Account',
                  onClick: () => setShowAddCalendar(true),
                },
                {
                  label: 'Subscribe to Calendar (.ics)',
                  onClick: () => setShowSubscribeCalendar(true),
                },
              ]}
              onClose={() => setAddCalendarMenu(null)}
              menuId="add-calendar"
            />,
            document.body
          )}
        <CreateCalendarModal
          isOpen={showCreateCalendar}
          onClose={() => {
            setShowCreateCalendar(false)
            setCreateCalendarAccountId(null)
          }}
          accountId={createCalendarAccountId}
        />
        <DeleteCalendarDialog
          isOpen={showDeleteCalendar}
          calendarId={deleteCalendarId}
          calendarName={deleteCalendarName}
          onClose={() => {
            setShowDeleteCalendar(false)
            setDeleteCalendarId(null)
            setDeleteCalendarName('')
          }}
          onConfirm={async () => {
            if (deleteCalendarId) {
              try {
                await deleteCalendarFromServer(deleteCalendarId)
              } catch (error) {
                showToast(error instanceof Error ? error.message : 'Failed to delete calendar')
              }
            }
          }}
        />
        {contextMenu &&
          createPortal(
            <ContextMenu
              x={contextMenu.x}
              y={contextMenu.y}
              items={[
                {
                  label: calendars.find((c) => c.id === contextMenu.calendarId)?.showTasksInViews
                    ? 'Hide Tasks in Views'
                    : 'Show Tasks in Views',
                  onClick: () => {
                    const calendar = calendars.find((c) => c.id === contextMenu.calendarId)
                    if (calendar) {
                      updateCalendar(contextMenu.calendarId, {
                        showTasksInViews: !calendar.showTasksInViews,
                      })
                    }
                    closeContextMenu()
                  },
                },
                {
                  label: hideCompletedTasksInMonthView
                    ? 'Show Completed Tasks'
                    : 'Hide Completed Tasks',
                  onClick: () => {
                    updateSettings({ hideCompletedTasksInMonthView: !hideCompletedTasksInMonthView })
                    closeContextMenu()
                  },
                },
                // CalDAV calendar options
                ...calendars.find((c) => c.id === contextMenu.calendarId)?.accountId
                  ? [
                      {
                        label: 'Rename',
                        onClick: () => {
                          const calendar = calendars.find((c) => c.id === contextMenu.calendarId)
                          if (calendar) {
                            setEditingId(calendar.id)
                            setEditName(calendar.name)
                          }
                          closeContextMenu()
                        },
                      },
                      {
                        label: 'Create Calendar Here',
                        onClick: () => {
                          const calendar = calendars.find((c) => c.id === contextMenu.calendarId)
                          if (calendar?.accountId) {
                            setCreateCalendarAccountId(calendar.accountId)
                            setShowCreateCalendar(true)
                          }
                          closeContextMenu()
                        },
                      },
                      {
                        label: 'Delete',
                        onClick: () => {
                          const calendar = calendars.find((c) => c.id === contextMenu.calendarId)
                          if (calendar) {
                            setDeleteCalendarId(calendar.id)
                            setDeleteCalendarName(calendar.name)
                            setShowDeleteCalendar(true)
                          }
                          closeContextMenu()
                        },
                      },
                    ]
                  : [
                      {
                        label: 'Remove',
                        onClick: () => {
                          deleteCalendar(contextMenu.calendarId)
                          closeContextMenu()
                        },
                      },
                    ],
              ]}
              onClose={closeContextMenu}
              menuId="calendar-context"
            />,
            document.body
          )}
        {!isCompact && !isCollapsed && (
          <div
            className={styles.resizer}
            onMouseDown={handleSidebarResizeStart}
          />
        )}
        </div>
      </div>
    </>
  )
}

function UpdateIndicator(): JSX.Element {
  const prefersReducedMotion = useReducedMotion()
  const { hasUpdate, latestVersion, releaseUrl, dismiss } = useUpdateCheck()
  const [showPopup, setShowPopup] = useState(false)
  const [popupPos, setPopupPos] = useState<{ x: number; bottom: number } | null>(null)
  const triggerRef = useRef<HTMLAnchorElement>(null)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearHideTimeout = (): void => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
  }

  const updatePosition = (): void => {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect()
      setPopupPos({ x: rect.left, bottom: window.innerHeight - rect.top + 8 })
    }
  }

  const handleMouseEnter = (): void => {
    clearHideTimeout()
    updatePosition()
    setShowPopup(true)
  }

  const handleMouseLeave = (): void => {
    timeoutRef.current = setTimeout(() => setShowPopup(false), 150)
  }

  if (!hasUpdate || !latestVersion) {
    return (
      <a
        href={`https://github.com/${config.githubRepo}`}
        target="_blank"
        rel="noopener noreferrer"
        className={styles.footerLink}
      >
        GitHub
      </a>
    )
  }

  return (
    <>
      <a
        ref={triggerRef}
        href={releaseUrl ?? `https://github.com/${config.githubRepo}`}
        target="_blank"
        rel="noopener noreferrer"
        className={`${styles.footerLink} ${styles.updateLink}`}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <span className={styles.updateDot} />
        <span className={styles.updateShimmer}>GitHub</span>
      </a>
      {createPortal(
        <AnimatePresence>
          {showPopup && (
            <motion.div
              className={styles.updatePopup}
              style={{
                position: 'fixed',
                left: popupPos?.x ?? 0,
                bottom: popupPos?.bottom ?? 0,
                width: 220,
              }}
              initial={prefersReducedMotion ? false : { opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: 4 }}
              transition={{ duration: prefersReducedMotion ? 0 : 0.15 }}
              onMouseEnter={handleMouseEnter}
              onMouseLeave={handleMouseLeave}
            >
              <p className={styles.updatePopupText}>
                <span className={styles.updatePopupVersion}>Calino {latestVersion}</span> is
                available
              </p>
              <p className={styles.updatePopupCurrent}>
                You have {config.appVersion}
              </p>
              <div className={styles.updatePopupActions}>
                <button className={styles.updateDismissBtn} onClick={dismiss}>
                  Dismiss
                </button>
                <a
                  href={releaseUrl ?? `https://github.com/${config.githubRepo}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.updateViewBtn}
                >
                  View release
                </a>
              </div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </>
  )
}

function ChevronLeft(): JSX.Element {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path
        d="M10 12L6 8L10 4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function ChevronRight(): JSX.Element {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path
        d="M6 4L10 8L6 12"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function ChevronDown({ className }: { className?: string }): JSX.Element {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none" className={className}>
      <path
        d="M4 6L8 10L12 6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function PlusIcon(): JSX.Element {
  return (
    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path
        d="M7 3V11M3 7H11"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
