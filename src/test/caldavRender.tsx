import type { ReactNode } from 'react'
import { render as rtlRender, renderHook as rtlRenderHook } from '@testing-library/react'
import type {
  RenderOptions,
  RenderResult,
  RenderHookOptions,
  RenderHookResult,
} from '@testing-library/react'
import { CalDAVProvider } from '@/features/caldav/hooks/CalDAVProvider'

/**
 * `render` / `renderHook` for tests whose subject reads the shared CalDAV
 * instance from context. The app mounts one <CalDAVProvider> at its root; these
 * supply the equivalent so the consumer isn't rendered bare.
 *
 * Tests that mock the useCalDAV module don't need these — no provider is
 * reached — and neither do tests with no CalDAV consumer in their tree.
 */
const wrapper = ({ children }: { children: ReactNode }): ReactNode => (
  <CalDAVProvider>{children}</CalDAVProvider>
)

export function render(ui: ReactNode, options?: RenderOptions): RenderResult {
  return rtlRender(ui, { wrapper, ...options })
}

export function renderHook<Result, Props>(
  callback: (initialProps: Props) => Result,
  options?: RenderHookOptions<Props>
): RenderHookResult<Result, Props> {
  return rtlRenderHook(callback, { wrapper, ...options })
}
