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
          <h2>3. CORS Proxy (Optional)</h2>
          <p>
            If your CalDAV server does not support CORS, you can optionally use a CORS proxy to
            enable browser access.
          </p>
          <p>
            <strong>Calino-hosted proxy (proxy.calino.io):</strong> We provide a public CORS proxy
            at <code>proxy.calino.io</code>. If you use this option:
          </p>
          <ul>
            <li>We can see your IP address, country, and the URL of your CalDAV server</li>
            <li>
              We <strong>cannot</strong> see your username, password, or calendar event data
            </li>
            <li>Credentials are sent in the Authorization header (not logged)</li>
            <li>Request/response bodies containing calendar data are not logged</li>
          </ul>
          <p>
            <strong>Third-party or self-hosted proxies:</strong> The same principles apply — the
            proxy operator sees connection metadata but not your credentials or calendar content.
          </p>
          <p>
            For maximum privacy, add CORS headers directly to your CalDAV server instead of using a
            proxy.
          </p>
        </section>

        <section>
          <h2>4. Cookies & Local Storage</h2>
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
          <h2>5. No Account Required</h2>
          <p>
            Calino does not require registration or an account. You can use the app immediately
            without providing any personal information.
          </p>
        </section>

        <section>
          <h2>6. Contact</h2>
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
