import { useMemo } from 'react'
import type { JSX } from 'react'
import { useTranslation } from 'react-i18next'
import { useHomeTimezoneOverride } from '@/lib/homeTimezone'
import { getTimezoneAbbr } from '@/lib/timezoneHelper'

/** Short zone name shown in a time grid's corner while a home timezone is chosen. */
export function HomeZoneLabel({
  date,
  className,
}: {
  date: Date
  className?: string
}): JSX.Element | null {
  const { t } = useTranslation('calendar')
  const zone = useHomeTimezoneOverride()
  const abbr = useMemo(() => (zone ? getTimezoneAbbr(date, zone) : ''), [date, zone])
  if (!zone) return null
  return (
    <span
      className={className}
      data-component="home-zone-label"
      title={t('views.homeTimezone.title', { zone })}
    >
      {abbr}
    </span>
  )
}
