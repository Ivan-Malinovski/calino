import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createCommandRegistry } from '../commands'

describe('createCommandRegistry', () => {
  const mockNavigate = vi.fn()
  const mockSetCurrentView = vi.fn()
  const mockSetCurrentDate = vi.fn()
  const mockOpenModal = vi.fn()
  const mockUpdateSettings = vi.fn()
  const mockTriggerSync = vi.fn()

  const mockOpenJournalModal = vi.fn()

  const defaultDeps = {
    navigate: mockNavigate,
    setCurrentView: mockSetCurrentView,
    setCurrentDate: mockSetCurrentDate,
    openModal: mockOpenModal,
    openJournalModal: mockOpenJournalModal,
    themeMode: 'light' as const,
    caldavDebugMode: false,
    updateSettings: mockUpdateSettings,
    triggerSync: mockTriggerSync,
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ── Actions ──────────────────────────────────────

  describe('action commands', () => {
    it('Create Event opens modal without task mode', () => {
      const commands = createCommandRegistry(defaultDeps)
      const cmd = commands.find((c) => c.id === 'action-new-event')!
      expect(cmd).toBeDefined()

      cmd.action()

      expect(mockOpenModal).toHaveBeenCalledWith()
    })

    it('New Task opens modal with task mode', () => {
      const commands = createCommandRegistry(defaultDeps)
      const cmd = commands.find((c) => c.id === 'action-new-task')!
      expect(cmd).toBeDefined()

      cmd.action()

      expect(mockOpenModal).toHaveBeenCalledWith(undefined, undefined, undefined, 'task')
    })

    it('Open Settings navigates to /settings', () => {
      const commands = createCommandRegistry(defaultDeps)
      const cmd = commands.find((c) => c.id === 'settings-open')!

      cmd.action()

      expect(mockNavigate).toHaveBeenCalledWith('/settings')
    })
  })

  // ── Settings ─────────────────────────────────────

  describe('settings commands', () => {
    it('navigates to correct tab for each settings command', () => {
      const commands = createCommandRegistry(defaultDeps)

      const cases: Array<[string, string]> = [
        ['settings-general', '/settings?tab=general'],
        ['settings-theme', '/settings?tab=theme'],
        ['settings-calendars', '/settings?tab=calendar'],
        ['settings-events', '/settings?tab=events'],
        ['settings-sync', '/settings?tab=caldav'],
        ['settings-data', '/settings?tab=data'],
      ]

      for (const [id, path] of cases) {
        const cmd = commands.find((c) => c.id === id)!
        expect(cmd, `command ${id} should exist`).toBeDefined()
        cmd.action()
        expect(mockNavigate).toHaveBeenCalledWith(path)
        mockNavigate.mockClear()
      }
    })

    it('Toggle CalDAV Debug Mode flips the setting', () => {
      const commands = createCommandRegistry({
        ...defaultDeps,
        caldavDebugMode: false,
      })
      const cmd = commands.find((c) => c.id === 'debug-toggle')!
      expect(cmd).toBeDefined()

      const result = cmd.action()

      expect(mockUpdateSettings).toHaveBeenCalledWith({ caldavDebugMode: true })
      expect(result).toBe('CalDAV debug mode enabled')
    })

    it('Toggle CalDAV Debug Mode disables when currently on', () => {
      const commands = createCommandRegistry({
        ...defaultDeps,
        caldavDebugMode: true,
      })
      const cmd = commands.find((c) => c.id === 'debug-toggle')!

      const result = cmd.action()

      expect(mockUpdateSettings).toHaveBeenCalledWith({ caldavDebugMode: false })
      expect(result).toBe('CalDAV debug mode disabled')
    })
  })

  // ── Navigation ───────────────────────────────────

  describe('navigation commands', () => {
    it('Go to Today sets current date to today', () => {
      const commands = createCommandRegistry(defaultDeps)
      const cmd = commands.find((c) => c.id === 'nav-today')!

      cmd.action()

      expect(mockSetCurrentDate).toHaveBeenCalled()
    })

    it('view commands set the correct view', () => {
      const commands = createCommandRegistry(defaultDeps)

      const viewCases: Array<[string, string]> = [
        ['nav-month', 'month'],
        ['nav-week', 'week'],
        ['nav-day', 'day'],
        ['nav-agenda', 'agenda'],
      ]

      for (const [id, view] of viewCases) {
        const cmd = commands.find((c) => c.id === id)
        if (cmd) {
          cmd.action()
          expect(mockSetCurrentView).toHaveBeenCalledWith(view)
          mockSetCurrentView.mockClear()
        }
      }
    })
  })

  // ── Metadata ─────────────────────────────────────

  describe('command metadata', () => {
    it('all commands have required fields', () => {
      const commands = createCommandRegistry(defaultDeps)

      for (const cmd of commands) {
        expect(cmd.id, `cmd ${cmd.id} needs id`).toBeTruthy()
        expect(cmd.label, `cmd ${cmd.id} needs label`).toBeTruthy()
        expect(cmd.category, `cmd ${cmd.id} needs category`).toBeTruthy()
        expect(cmd.keywords.length, `cmd ${cmd.id} needs keywords`).toBeGreaterThan(0)
        expect(typeof cmd.action, `cmd ${cmd.id} action must be fn`).toBe('function')
      }
    })

    it('no duplicate command IDs', () => {
      const commands = createCommandRegistry(defaultDeps)
      const ids = commands.map((c) => c.id)
      expect(new Set(ids).size).toBe(ids.length)
    })
  })
})
