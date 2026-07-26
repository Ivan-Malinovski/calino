import { useState, useEffect } from 'react'
import { formatTime } from '@/lib/datetime'
import type { TimeFormat } from '@/types'
import styles from './CurrentTimeIndicator.module.css'

interface CurrentTimeIndicatorProps {
  /** Height of one hour in pixels */
  hourHeight: number
  /** User's time-format preference (12h/24h) */
  timeFormat: TimeFormat
  /** Whether to show the time label (left gutter) */
  showLabel?: boolean
  /** Optional className for the container */
  className?: string
}

export function CurrentTimeIndicator({
  hourHeight,
  timeFormat,
  showLabel = true,
  className,
}: CurrentTimeIndicatorProps) {
  const [now, setNow] = useState(new Date())

  useEffect(() => {
    const interval = setInterval(() => {
      setNow(new Date())
    }, 60_000)

    return () => clearInterval(interval)
  }, [])

  const minutesSinceMidnight = now.getHours() * 60 + now.getMinutes()
  const top = (minutesSinceMidnight / 60) * hourHeight

  return (
    <div className={`${styles.container} ${className ?? ''}`} style={{ top: `${top}px` }}>
      {showLabel && <div className={styles.label}>{formatTime(now, timeFormat)}</div>}
      <div className={styles.line} />
    </div>
  )
}
