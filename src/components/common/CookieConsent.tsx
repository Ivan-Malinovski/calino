import type { JSX } from 'react'
import { useState } from 'react'
import { Link } from 'react-router'
import styles from './CookieConsent.module.css'

const COOKIE_KEY = 'calino_cookie_notice'

export function CookieConsent(): JSX.Element | null {
  // Read the stored dismissal synchronously so we don't flash-then-show via an
  // effect (which also avoids a set-state-in-effect render).
  const [isVisible, setIsVisible] = useState(() => !localStorage.getItem(COOKIE_KEY))

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
