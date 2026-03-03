import type { JSX } from 'react'
import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import styles from './CookieConsent.module.css'

const COOKIE_KEY = 'goodcal_cookie_notice'

export function CookieConsent(): JSX.Element | null {
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    const stored = localStorage.getItem(COOKIE_KEY)
    if (!stored) {
      setIsVisible(true)
    }
  }, [])

  const handleDismiss = (): void => {
    localStorage.setItem(COOKIE_KEY, 'dismissed')
    setIsVisible(false)
  }

  if (!isVisible) return null

  return (
    <div className={styles.banner}>
      <div className={styles.content}>
        <span className={styles.text}>
          We use local storage to save your data. No tracking cookies.
          <Link to="/privacy" className={styles.link}>
            Privacy
          </Link>
        </span>
        <button onClick={handleDismiss} className={styles.dismiss}>
          Got it
        </button>
      </div>
    </div>
  )
}
