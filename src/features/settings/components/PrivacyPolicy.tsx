import type { JSX } from 'react'
import { useNavigate } from 'react-router-dom'
import { config } from '@/config'
import styles from './PrivacyPolicy.module.css'

export function PrivacyPolicy(): JSX.Element {
  const navigate = useNavigate()

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <button onClick={() => navigate(-1)} className={styles.backButton}>
          ← Back
        </button>
        <h1>Privacy Policy</h1>
      </div>

      <div className={styles.content}>
        <p className={styles.lastUpdated}>Last updated: March 2026</p>

        <section>
          <h2>1. Your Data Stays on Your Device</h2>
          <p>
            Calino is a local-first calendar application. All your calendar events, settings, and
            preferences are stored locally in your browser using IndexedDB and localStorage. We do
            not have access to your personal data.
          </p>
        </section>

        <section>
          <h2>2. CalDAV Sync (Optional)</h2>
          <p>
            Calino can sync with CalDAV servers (like Nextcloud, ownCloud, or other CalDAV-compliant
            services) you personally configure. When you add a CalDAV account:
          </p>
          <ul>
            <li>
              Your credentials (username/password) are stored only in your browser&apos;s
              localStorage
            </li>
            <li>Data is transferred directly between your browser and your CalDAV server</li>
            <li>We never see or store your credentials on any external server</li>
          </ul>
        </section>

        <section>
          <h2>3. Cookies & Local Storage</h2>
          <p>Calino uses localStorage to store:</p>
          <ul>
            <li>Your preferences and settings</li>
            <li>CalDAV account credentials (encrypted only in your browser)</li>
          </ul>
          <p>
            We do not use tracking cookies, analytics, or third-party services that collect personal
            information.
          </p>
        </section>

        <section>
          <h2>4. No Account Required</h2>
          <p>
            Calino does not require registration or an account. You can use the app immediately
            without providing any personal information.
          </p>
        </section>

        <section>
          <h2>5. Contact</h2>
          <p>
            If you have questions about this privacy policy, please contact:
            <br />
            <a href={`mailto:${config.contactEmail}`}>{config.contactEmail}</a>
          </p>
        </section>
      </div>
    </div>
  )
}
