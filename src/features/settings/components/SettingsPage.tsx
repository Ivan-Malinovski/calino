import type { JSX } from 'react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { GeneralSettings } from './GeneralSettings'
import { CalendarSettings } from './CalendarSettings'
import { EventDefaultsSettings } from './EventDefaultsSettings'
import { NotificationSettings } from './NotificationSettings'
import { DataSettings } from './DataSettings'
import { CalDAVSettings } from './CalDAVSettings'
import styles from './Settings.module.css'

type SettingsTab = 'general' | 'calendar' | 'events' | 'notifications' | 'caldav' | 'data'

interface NavItem {
  id: SettingsTab
  label: string
  icon: JSX.Element
}

const NAV_ITEMS: NavItem[] = [
  {
    id: 'general',
    label: 'General',
    icon: (
      <svg
        className={styles.navIcon}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <circle cx="12" cy="12" r="3" />
        <path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83" />
      </svg>
    ),
  },
  {
    id: 'calendar',
    label: 'Calendar',
    icon: (
      <svg
        className={styles.navIcon}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
      </svg>
    ),
  },
  {
    id: 'events',
    label: 'Events',
    icon: (
      <svg
        className={styles.navIcon}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
      </svg>
    ),
  },
  {
    id: 'notifications',
    label: 'Notifications',
    icon: (
      <svg
        className={styles.navIcon}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      </svg>
    ),
  },
  {
    id: 'caldav',
    label: 'Sync',
    icon: (
      <svg
        className={styles.navIcon}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <path d="M21 12a9 9 0 0 1-9 9m9-9a9 9 0 0 0-9-9m9 9H3m9 9a9 9 0 0 1-9-9m9 9c1.66 0 3-4.03 3-9s-1.34-9-3-9m0 18c-1.66 0-3-4.03-3-9s1.34-9 3-9" />
      </svg>
    ),
  },
  {
    id: 'data',
    label: 'Data',
    icon: (
      <svg
        className={styles.navIcon}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <ellipse cx="12" cy="5" rx="9" ry="3" />
        <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
        <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
      </svg>
    ),
  },
]

export function SettingsPage(): JSX.Element {
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState<SettingsTab>('general')

  const renderContent = (): JSX.Element => {
    switch (activeTab) {
      case 'general':
        return <GeneralSettings />
      case 'calendar':
        return <CalendarSettings />
      case 'events':
        return <EventDefaultsSettings />
      case 'notifications':
        return <NotificationSettings />
      case 'caldav':
        return <CalDAVSettings />
      case 'data':
        return <DataSettings />
      default:
        return <GeneralSettings />
    }
  }

  const getTitle = (): string => {
    switch (activeTab) {
      case 'general':
        return 'General Settings'
      case 'calendar':
        return 'Calendar Display'
      case 'events':
        return 'Event Defaults'
      case 'notifications':
        return 'Notifications'
      case 'caldav':
        return 'CalDAV Sync'
      case 'data':
        return 'Data & Storage'
      default:
        return 'Settings'
    }
  }

  return (
    <div className={styles.container}>
      <aside className={styles.sidebar}>
        <h1 className={styles.sidebarTitle}>Settings</h1>
        <nav className={styles.nav}>
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              className={`${styles.navItem} ${activeTab === item.id ? styles.active : ''}`}
              onClick={() => setActiveTab(item.id)}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </nav>
      </aside>
      <main className={styles.content}>
        <div className={styles.header}>
          <button className={styles.backButton} onClick={() => navigate('/')}>
            ← Back to Calendar
          </button>
        </div>
        <h2 className={styles.pageTitle}>{getTitle()}</h2>
        {renderContent()}
      </main>
    </div>
  )
}
