import type { JSX, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useSettingsStore } from '@/store/settingsStore'
import { buildMapUrl } from '@/lib/mapProvider'

interface LocationLinkProps {
  location: string
  className?: string
  /**
   * Custom content to render inside the link. When omitted, the location
   * string is rendered as a span.
   */
  children?: ReactNode
  /**
   * When true, renders only the external-link icon (no text). Use when the
   * location text is already shown separately (e.g. in a click-to-edit field)
   * and you just want a small icon button to open the maps link.
   */
  iconOnly?: boolean
  /** ARIA label override; defaults to "Open [location] in Maps". */
  ariaLabel?: string
}

const externalLinkIcon = (
  <svg
    aria-hidden="true"
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    <polyline points="15 3 21 3 21 9" />
    <line x1="10" y1="14" x2="21" y2="3" />
  </svg>
)

/**
 * Renders an event location as a link that opens a maps search in a new tab.
 * Click propagation is stopped so embedding this inside an event card doesn't
 * trigger the card's own click handler.
 */
export function LocationLink({
  location,
  className,
  children,
  iconOnly = false,
  ariaLabel,
}: LocationLinkProps): JSX.Element {
  const { t } = useTranslation('calendar')
  const mapProvider = useSettingsStore((s) => s.mapProvider)
  const mapsUrl = buildMapUrl(mapProvider, location)
  return (
    <a
      href={mapsUrl}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
      onClick={(e) => e.stopPropagation()}
      aria-label={ariaLabel ?? t('ui.location.openInMaps', { location })}
      title={t('ui.location.openInMapsTitle', { location })}
    >
      {iconOnly ? externalLinkIcon : (children ?? <span>{location}</span>)}
    </a>
  )
}
