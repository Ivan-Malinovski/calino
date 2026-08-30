import { Capacitor } from '@capacitor/core'

const MIN_DAY = 1
const MAX_DAY = 31
const FONT_FAMILY =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"

export function createDynamicFaviconSvg(day: number): string {
  if (!Number.isInteger(day) || day < MIN_DAY || day > MAX_DAY) {
    throw new RangeError(`Expected an integer day from ${MIN_DAY} to ${MAX_DAY}`)
  }

  const singleDigit = day < 10
  // Sized to stay readable at 16px tab size next to Google Calendar's day icon.
  // Extra-bold, not black: 900 turns double digits into a blob at favicon size.
  const fontSize = singleDigit ? 180 : 170
  const letterSpacing = singleDigit ? '-0.06em' : '-0.08em'
  const numericAttributes = singleDigit ? '' : ' font-variant-numeric="tabular-nums"'

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
  <rect width="256" height="256" rx="56" fill="#b07d4f"/>
  <text x="128" y="190" text-anchor="middle" fill="#faf8f3" font-family="${FONT_FAMILY}" font-size="${fontSize}" font-weight="800" letter-spacing="${letterSpacing}"${numericAttributes}>${day}</text>
  <circle cx="198" cy="198" r="38" fill="#b07d4f"/>
  <rect x="180" y="180" width="36" height="36" rx="6" fill="#faf8f3" transform="rotate(45 198 198)"/>
</svg>`
}

export function createDynamicFaviconDataUrl(day: number): string {
  return `data:image/svg+xml,${encodeURIComponent(createDynamicFaviconSvg(day))}`
}

export function millisecondsUntilNextLocalDay(now: Date): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  return next.getTime() - now.getTime()
}

export function setDynamicFavicon(
  day: number,
  targetDocument: Document = document
): HTMLLinkElement {
  let link = targetDocument.querySelector<HTMLLinkElement>('link[rel~="icon"]')

  if (!link) {
    link = targetDocument.createElement('link')
    link.rel = 'icon'
    targetDocument.head.append(link)
  }

  link.type = 'image/svg+xml'
  link.href = createDynamicFaviconDataUrl(day)
  return link
}

interface DynamicFaviconEnvironment {
  targetDocument?: Document
  targetWindow?: Window
  now?: () => Date
}

export function startDynamicFavicon({
  targetDocument = document,
  targetWindow = window,
  now = () => new Date(),
}: DynamicFaviconEnvironment = {}): () => void {
  if (Capacitor.isNativePlatform()) return () => {}

  let timeoutId: ReturnType<Window['setTimeout']> | undefined

  const scheduleNextDay = (): void => {
    if (timeoutId !== undefined) targetWindow.clearTimeout(timeoutId)
    // A small cushion avoids sampling the old day on an imprecise timer.
    timeoutId = targetWindow.setTimeout(refresh, millisecondsUntilNextLocalDay(now()) + 1000)
  }

  const refresh = (): void => {
    setDynamicFavicon(now().getDate(), targetDocument)
    scheduleNextDay()
  }

  const handleVisibilityChange = (): void => {
    if (targetDocument.visibilityState === 'visible') refresh()
  }
  const handlePageShow = (): void => refresh()

  targetDocument.addEventListener('visibilitychange', handleVisibilityChange)
  targetWindow.addEventListener('pageshow', handlePageShow)
  refresh()

  return () => {
    if (timeoutId !== undefined) targetWindow.clearTimeout(timeoutId)
    targetDocument.removeEventListener('visibilitychange', handleVisibilityChange)
    targetWindow.removeEventListener('pageshow', handlePageShow)
  }
}
