import { useEffect } from 'react'
import { Capacitor } from '@capacitor/core'
import { createWebMCPTools, type WebMCPTool } from './tools'
import { useWebMCPSettings } from './settings'

// Keep the experimental platform surface isolated; no polyfill or global types.
interface ModelContext {
  registerTool: (tool: WebMCPTool, options: { signal: AbortSignal }) => Promise<void> | void
  unregisterTool?: (name: string) => void
}

export function getModelContext(): ModelContext | undefined {
  if (Capacitor.isNativePlatform() || !window.isSecureContext) return undefined
  const current = (document as Document & { modelContext?: ModelContext }).modelContext
  if (typeof current?.registerTool === 'function') return current
  // Older Chromium-based browsers expose the API on Navigator instead.
  const legacy = (navigator as Navigator & { modelContext?: ModelContext }).modelContext
  return typeof legacy?.registerTool === 'function' ? legacy : undefined
}

export function useWebMCP(): void {
  const enabled = useWebMCPSettings((state) => state.enabled)
  useEffect(() => {
    const context = getModelContext()
    if (enabled !== true || !context) return
    const controller = new AbortController()
    const registered = new Set<string>()
    const cleanup = (): void => {
      controller.abort()
      // The early Navigator API predates AbortSignal-based unregistration.
      if (context.unregisterTool) {
        for (const name of registered) {
          try {
            context.unregisterTool(name)
          } catch {
            // Stale callbacks remain guarded even if the browser cannot remove them.
          }
        }
      }
      registered.clear()
    }
    void (async () => {
      try {
        for (const tool of createWebMCPTools()) {
          if (controller.signal.aborted) return
          const registration = context.registerTool(
            {
              ...tool,
              execute: (input) => {
                if (controller.signal.aborted || useWebMCPSettings.getState().enabled !== true)
                  return { error: 'WebMCP access is disabled.' }
                return tool.execute(input)
              },
            },
            { signal: controller.signal }
          )
          registered.add(tool.name)
          await registration
          if (controller.signal.aborted) cleanup()
        }
      } catch {
        // Roll back partial registration, including Permissions Policy denial.
        cleanup()
      }
    })()
    return cleanup
  }, [enabled])
}
