import type { JSX } from 'react'
import { useMemo, useState, useRef, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { Capacitor } from '@capacitor/core'
import { GeneralSettings } from './GeneralSettings'
import { ThemeSettings } from './ThemeSettings'
import { CalendarSettings } from './CalendarSettings'
import { TasksSettings } from './TasksSettings'
import { NotificationSettings } from './NotificationSettings'
import { DataSettings } from './DataSettings'
import { CalDAVSettings } from './CalDAVSettings'
import { CategoriesSettings } from './CategoriesSettings'
import { AIVisionSettings } from './AIVisionSettings'
import { useCalendarStore } from '@/store/calendarStore'
import { useSettingsStore } from '@/store/settingsStore'
import { useIsMobile } from '@/hooks/useIsMobile'
import { FloatingNavPill } from '@/features/calendar/components/nav/FloatingNavPill'
import styles from './Settings.module.css'

type SettingsTab =
  | 'general'
  | 'theme'
  | 'calendar'
  | 'tasks'
  | 'categories'
  | 'notifications'
  | 'caldav'
  | 'data'
  | 'aiVision'

interface NavItem {
  id: SettingsTab
  labelKey: string
  icon: JSX.Element
}

interface SettingsSearchEntry {
  tab: SettingsTab
  title: string
  sectionTitle: string
  searchableText: string
  isSectionFallback?: boolean
}

interface SettingsSearchResult {
  tab: SettingsTab
  title: string
  sectionTitle: string
}

const SETTINGS_SEARCH_SECTIONS: Array<{
  tab: SettingsTab
  resourceKey: string
  labelKey: string
}> = [
  { tab: 'general', resourceKey: 'general', labelKey: 'nav.general' },
  { tab: 'theme', resourceKey: 'theme', labelKey: 'nav.appearance' },
  { tab: 'calendar', resourceKey: 'calendar', labelKey: 'nav.calendar' },
  { tab: 'tasks', resourceKey: 'tasks', labelKey: 'nav.tasks' },
  { tab: 'categories', resourceKey: 'categories', labelKey: 'nav.categories' },
  { tab: 'notifications', resourceKey: 'notifications', labelKey: 'nav.notifications' },
  { tab: 'caldav', resourceKey: 'caldav', labelKey: 'nav.sync' },
  { tab: 'data', resourceKey: 'data', labelKey: 'nav.data' },
  { tab: 'aiVision', resourceKey: 'aiVision', labelKey: 'nav.aiVision' },
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function collectSearchText(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(collectSearchText)
  if (!isRecord(value)) return []
  return Object.values(value).flatMap(collectSearchText)
}

function buildSettingsSearchIndex(
  resource: unknown,
  sections: typeof SETTINGS_SEARCH_SECTIONS,
  isNative: boolean,
  getSectionTitle: (key: string) => string
): SettingsSearchEntry[] {
  if (!isRecord(resource)) return []

  return sections.flatMap(({ tab, resourceKey, labelKey }) => {
    if (tab === 'aiVision' && !isNative) return []
    const section = resource[resourceKey]
    if (!isRecord(section)) return []

    const sectionTitle = getSectionTitle(labelKey)
    const entries: SettingsSearchEntry[] = []
    const visit = (value: unknown): void => {
      if (!isRecord(value)) return
      if (typeof value.label === 'string') {
        entries.push({
          tab,
          title: value.label,
          sectionTitle,
          searchableText: collectSearchText(value).join(' '),
        })
      }
      Object.values(value).forEach(visit)
    }
    visit(section)

    // Some sections (such as Sync) describe actions rather than individual
    // setting rows, so keep their translated copy searchable as one result.
    entries.push({
      tab,
      title: sectionTitle,
      sectionTitle,
      searchableText: [sectionTitle, ...collectSearchText(section)].join(' '),
      isSectionFallback: true,
    })
    return entries
  })
}

function normalizeSearchText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
}

function findSettingsSearchResults(
  entries: SettingsSearchEntry[],
  query: string
): SettingsSearchResult[] {
  const normalizedQuery = normalizeSearchText(query.trim())
  if (!normalizedQuery) return []
  const terms = normalizedQuery.split(/\s+/)
  const matches = entries.filter((entry) => {
    const searchableText = normalizeSearchText(
      `${entry.title} ${entry.sectionTitle} ${entry.searchableText}`
    )
    return terms.every((term) => searchableText.includes(term))
  })
  const tabsWithSettingMatches = new Set(
    matches.filter((entry) => !entry.isSectionFallback).map((entry) => entry.tab)
  )
  const titleRank = (title: string): number => {
    const normalizedTitle = normalizeSearchText(title)
    if (normalizedTitle.startsWith(normalizedQuery)) return 0
    return normalizedTitle.includes(normalizedQuery) ? 1 : 2
  }

  return matches
    .filter((entry) => !entry.isSectionFallback || !tabsWithSettingMatches.has(entry.tab))
    .sort((a, b) => {
      return titleRank(a.title) - titleRank(b.title) || a.title.localeCompare(b.title)
    })
    .slice(0, 8)
    .map(({ tab, title, sectionTitle }) => ({ tab, title, sectionTitle }))
}

const BASE_NAV_ITEMS: NavItem[] = [
  {
    id: 'general',
    labelKey: 'nav.general',
    icon: (
      <svg
        className={styles.navIcon}
        viewBox="0 0 18 18"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      >
        <circle cx="9" cy="9" r="2.5" />
        <path d="M9 1v2M9 15v2M1 9h2M15 9h2M3.22 3.22l1.42 1.42M13.36 13.36l1.42 1.42M3.22 14.78l1.42-1.42M13.36 4.64l1.42-1.42" />
      </svg>
    ),
  },
  {
    id: 'theme',
    labelKey: 'nav.appearance',
    icon: (
      <svg
        className={styles.navIcon}
        viewBox="0 0 18 18"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M9 2a7 7 0 100 14A4 4 0 009 2z" />
        <circle cx="6" cy="7" r="1" />
        <circle cx="11" cy="5.5" r="1" />
        <circle cx="13" cy="10" r="1" />
        <circle cx="7.5" cy="12.5" r="1" />
      </svg>
    ),
  },
  {
    id: 'calendar',
    labelKey: 'nav.calendar',
    icon: (
      <svg
        className={styles.navIcon}
        viewBox="0 0 18 18"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="2" y="3" width="14" height="13" rx="3" />
        <path d="M2 7h14M6 2v2M12 2v2" />
      </svg>
    ),
  },
  {
    id: 'tasks',
    labelKey: 'nav.tasks',
    icon: (
      <svg
        className={styles.navIcon}
        viewBox="0 0 18 18"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M2 4l1.5 1.5L6 3M2 10l1.5 1.5L6 9M9 4h7M9 10h7M9 15h7" />
      </svg>
    ),
  },
  {
    id: 'categories',
    labelKey: 'nav.categories',
    icon: (
      <svg
        className={styles.navIcon}
        viewBox="0 0 18 18"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M2 4h14M2 9h14M2 14h8" />
        <circle cx="14" cy="14" r="2.5" />
        <path d="M14 12.5v1.5h1.5" />
      </svg>
    ),
  },
  {
    id: 'notifications',
    labelKey: 'nav.notifications',
    icon: (
      <svg
        className={styles.navIcon}
        viewBox="0 0 18 18"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M9 2a5 5 0 00-5 5c0 3-1.5 4-1.5 4h13S14 10 14 7a5 5 0 00-5-5z" />
        <path d="M7.5 15a1.5 1.5 0 003 0" />
      </svg>
    ),
  },
  {
    id: 'caldav',
    labelKey: 'nav.sync',
    icon: (
      <svg
        className={styles.navIcon}
        viewBox="0 0 18 18"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M3 9a6 6 0 0110.7-3.7M15 9a6 6 0 01-10.7 3.7" />
        <path d="M12.5 5l1.2 1.2-1.2 1.2M5.5 13l-1.2-1.2 1.2-1.2" />
      </svg>
    ),
  },
  {
    id: 'data',
    labelKey: 'nav.data',
    icon: (
      <svg
        className={styles.navIcon}
        viewBox="0 0 18 18"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <ellipse cx="9" cy="5" rx="6" ry="2.5" />
        <path d="M3 5v4c0 1.4 2.7 2.5 6 2.5S15 10.4 15 9V5" />
        <path d="M3 9v4c0 1.4 2.7 2.5 6 2.5S15 14.4 15 13V9" />
      </svg>
    ),
  },
]

const AI_VISION_NAV_ITEM: NavItem = {
  id: 'aiVision',
  labelKey: 'nav.aiVision',
  icon: (
    <svg
      className={styles.navIcon}
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="2" y="5" width="14" height="10" rx="2.5" />
      <path d="M6 5l1-2h4l1 2" />
      <circle cx="9" cy="10" r="2.5" />
    </svg>
  ),
}

const VALID_TABS: SettingsTab[] = [
  'general',
  'theme',
  'calendar',
  'tasks',
  'categories',
  'notifications',
  'caldav',
  'data',
  'aiVision',
]

export function SettingsPage(): JSX.Element {
  const { t, i18n } = useTranslation('settings')
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const isMobile = useIsMobile()
  const isNative = Capacitor.isNativePlatform()
  const navItems: NavItem[] = isNative ? [...BASE_NAV_ITEMS, AI_VISION_NAV_ITEM] : BASE_NAV_ITEMS
  const brokenEventsCount = useCalendarStore((state) => state.brokenEvents.length)
  const duplicateUidCount = useCalendarStore((state) => state.duplicateUidIssues.length)
  const dataIssuesCount = brokenEventsCount + duplicateUidCount

  const initialTab = ((): SettingsTab | null => {
    const tabParam = searchParams.get('tab')
    if (tabParam && VALID_TABS.includes(tabParam as SettingsTab)) {
      return tabParam as SettingsTab
    }
    // On mobile with no deep link, show the category list first instead of
    // jumping straight into General's content.
    return isMobile ? null : 'general'
  })()

  const [activeTab, setActiveTab] = useState<SettingsTab | null>(initialTab)
  const [searchQuery, setSearchQuery] = useState('')
  const [highlightedSetting, setHighlightedSetting] = useState<SettingsSearchResult | null>(null)
  const highlightTimerRef = useRef<number | null>(null)
  const highlightedElementRef = useRef<HTMLElement | null>(null)
  const searchIndex = useMemo(
    () =>
      buildSettingsSearchIndex(
        i18n.getResourceBundle(i18n.resolvedLanguage ?? i18n.language, 'settings'),
        SETTINGS_SEARCH_SECTIONS,
        isNative,
        (key) => t(key)
      ),
    [i18n, i18n.language, i18n.resolvedLanguage, isNative, t]
  )
  const searchResults = useMemo(
    () => findSettingsSearchResults(searchIndex, searchQuery),
    [searchIndex, searchQuery]
  )

  // Settings persist immediately on change (no explicit save), so flash a
  // transient "Saved" pill whenever any setting is updated to confirm it stuck.
  const [showSaved, setShowSaved] = useState(false)
  const savedTimerRef = useRef<number | null>(null)
  useEffect(() => {
    const unsubscribe = useSettingsStore.subscribe(() => {
      setShowSaved(true)
      if (savedTimerRef.current) window.clearTimeout(savedTimerRef.current)
      savedTimerRef.current = window.setTimeout(() => setShowSaved(false), 1600)
    })
    return () => {
      unsubscribe()
      if (savedTimerRef.current) window.clearTimeout(savedTimerRef.current)
    }
  }, [])

  const renderContent = (tab: SettingsTab, searchControl?: JSX.Element): JSX.Element => {
    switch (tab) {
      case 'general':
        return <GeneralSettings searchControl={searchControl} />
      case 'theme':
        return <ThemeSettings searchControl={searchControl} />
      case 'calendar':
        return <CalendarSettings searchControl={searchControl} />
      case 'tasks':
        return <TasksSettings searchControl={searchControl} />
      case 'categories':
        return <CategoriesSettings searchControl={searchControl} />
      case 'notifications':
        return <NotificationSettings searchControl={searchControl} />
      case 'caldav':
        return <CalDAVSettings searchControl={searchControl} />
      case 'data':
        return <DataSettings searchControl={searchControl} />
      case 'aiVision':
        return <AIVisionSettings searchControl={searchControl} />
      default:
        return <GeneralSettings searchControl={searchControl} />
    }
  }

  const selectSearchResult = (result: SettingsSearchResult): void => {
    setActiveTab(result.tab)
    setSearchQuery('')
    setHighlightedSetting(result)
  }

  useEffect(() => {
    if (highlightTimerRef.current !== null) {
      window.clearTimeout(highlightTimerRef.current)
      highlightTimerRef.current = null
    }
    highlightedElementRef.current?.classList.remove(styles.searchResultHighlight)
    highlightedElementRef.current = null
    if (!highlightedSetting || highlightedSetting.tab !== activeTab) return

    const frame = window.requestAnimationFrame(() => {
      const panel = document.querySelector<HTMLElement>('[data-component="settings-panel"]')
      const labels = panel?.querySelectorAll<HTMLElement>(
        `.${styles.rowLabel}, .${styles.groupLabel}`
      )
      const matchingLabel = Array.from(labels ?? []).find(
        (element) =>
          normalizeSearchText(element.textContent ?? '') ===
          normalizeSearchText(highlightedSetting.title)
      )
      const target = matchingLabel?.closest<HTMLElement>(`.${styles.row}`) ?? matchingLabel

      if (target) {
        target.classList.add(styles.searchResultHighlight)
        highlightedElementRef.current = target
        target.scrollIntoView({ block: 'center', behavior: 'smooth' })
        highlightTimerRef.current = window.setTimeout(() => {
          target.classList.remove(styles.searchResultHighlight)
          highlightedElementRef.current = null
          highlightTimerRef.current = null
          setHighlightedSetting(null)
        }, 2300)
      } else if (isMobile) {
        document
          .querySelector<HTMLElement>(
            `[data-component="settings-category-item"][data-tab="${highlightedSetting.tab}"]`
          )
          ?.scrollIntoView({ block: 'start', behavior: 'smooth' })
        setHighlightedSetting(null)
      } else {
        panel?.scrollTo({ top: 0, behavior: 'smooth' })
        setHighlightedSetting(null)
      }
    })

    return () => {
      window.cancelAnimationFrame(frame)
      if (highlightTimerRef.current !== null) {
        window.clearTimeout(highlightTimerRef.current)
        highlightTimerRef.current = null
      }
    }
  }, [activeTab, highlightedSetting, isMobile])

  const searchBox = (
    <div className={styles.search} role="search" data-component="settings-search">
      <svg
        className={styles.searchIcon}
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <circle cx="8.8" cy="8.8" r="5.8" />
        <path d="m13.2 13.2 4 4" />
      </svg>
      <input
        className={styles.searchInput}
        type="search"
        role="combobox"
        value={searchQuery}
        placeholder={t('nav.searchPlaceholder')}
        aria-label={t('nav.searchAriaLabel')}
        aria-autocomplete="list"
        aria-expanded={searchResults.length > 0}
        aria-controls={searchResults.length > 0 ? 'settings-search-results' : undefined}
        aria-activedescendant={searchResults.length > 0 ? 'settings-search-result-0' : undefined}
        onChange={(event) => setSearchQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && searchResults[0]) {
            event.preventDefault()
            selectSearchResult(searchResults[0])
          } else if (event.key === 'Escape' && searchQuery) {
            event.preventDefault()
            event.stopPropagation()
            setSearchQuery('')
          }
        }}
      />
      {searchQuery && (
        <button
          className={styles.searchClear}
          type="button"
          aria-label={t('nav.clearSearch')}
          onClick={() => setSearchQuery('')}
        >
          <svg
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="m4 4 8 8m0-8-8 8" />
          </svg>
        </button>
      )}
      {searchQuery.trim() && (
        <div
          className={styles.searchResults}
          id="settings-search-results"
          role={searchResults.length > 0 ? 'listbox' : 'status'}
          aria-label={t('nav.searchResults')}
        >
          {searchResults.length > 0 ? (
            searchResults.map((result, index) => (
              <button
                className={styles.searchResult}
                id={`settings-search-result-${index}`}
                key={`${result.tab}-${result.title}-${index}`}
                type="button"
                role="option"
                aria-selected={index === 0}
                onClick={() => selectSearchResult(result)}
              >
                <span className={styles.searchResultTitle}>{result.title}</span>
                <span className={styles.searchResultSection}>{result.sectionTitle}</span>
              </button>
            ))
          ) : (
            <p className={styles.searchEmpty}>{t('nav.noSearchResults')}</p>
          )}
        </div>
      )}
    </div>
  )

  return (
    <div className={styles.container} data-component="settings-page">
      <div className={styles.body}>
        <aside className={styles.nav} data-component="settings-sidebar">
          <button className={styles.back} onClick={() => navigate('/')}>
            <svg
              viewBox="0 0 14 14"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M9 2L4 7l5 5" />
            </svg>
            {t('nav.backToCalendar')}
          </button>
          <h2 className={styles.navTitle}>{t('nav.title')}</h2>
          <nav className={styles.navList} aria-label={t('nav.title')}>
            {navItems.map((item) => (
              <button
                key={item.id}
                className={`${styles.navItem} ${activeTab === item.id ? styles.navItemActive : ''}`}
                data-component="settings-nav-item"
                data-tab={item.id}
                aria-current={activeTab === item.id ? 'page' : undefined}
                onClick={() => {
                  setActiveTab(item.id)
                  setSearchQuery('')
                }}
              >
                {item.icon}
                {t(item.labelKey)}
                {item.id === 'data' && dataIssuesCount > 0 && (
                  <span className={styles.navBadge}>{dataIssuesCount}</span>
                )}
              </button>
            ))}
          </nav>
        </aside>
        <main
          className={styles.main}
          data-component="settings-panel"
          id="main-content"
          tabIndex={-1}
        >
          <div className={styles.savedBar} role="status" aria-live="polite">
            <span
              className={`${styles.savedPill} ${showSaved ? styles.savedPillVisible : ''}`}
              data-component="settings-saved-indicator"
            >
              <svg
                width="13"
                height="13"
                viewBox="0 0 14 14"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M2.5 7.5L6 11l5.5-8" />
              </svg>
              {t('saved')}
            </span>
          </div>
          {isMobile && <div className={styles.header}>{searchBox}</div>}
          {isMobile ? (
            <div data-component="settings-category-list">
              {/* Exactly one h1 per page: when a category is expanded its own
                  pageTitle h1 is the page heading, so this list title steps
                  down to h2 (a level decrease, not a skip). */}
              {activeTab ? (
                <h2 className={styles.mobileTitle}>{t('nav.title')}</h2>
              ) : (
                <h1 className={styles.mobileTitle}>{t('nav.title')}</h1>
              )}
              <nav className={styles.categoryList} aria-label={t('nav.settingsCategories')}>
                {navItems.map((item) => {
                  const isOpen = activeTab === item.id
                  return (
                    <div key={item.id} className={styles.accordionItem}>
                      <button
                        className={styles.categoryItem}
                        data-component="settings-category-item"
                        data-tab={item.id}
                        aria-expanded={isOpen}
                        onClick={() => {
                          setActiveTab(isOpen ? null : item.id)
                          setSearchQuery('')
                        }}
                      >
                        {item.icon}
                        <span className={styles.categoryLabel}>{t(item.labelKey)}</span>
                        <span className={styles.categoryTrailing}>
                          {item.id === 'data' && dataIssuesCount > 0 && (
                            <span className={styles.navBadge}>{dataIssuesCount}</span>
                          )}
                          <ChevronIcon className={isOpen ? styles.chevronOpen : styles.chevron} />
                        </span>
                      </button>
                      {isOpen && (
                        <div
                          className={styles.accordionPanel}
                          data-component="settings-accordion-panel"
                        >
                          {renderContent(item.id)}
                        </div>
                      )}
                    </div>
                  )
                })}
              </nav>
            </div>
          ) : (
            renderContent(activeTab ?? 'general', searchBox)
          )}
        </main>
      </div>
      <FloatingNavPill onToggleSidebar={() => navigate('/')} onOpenSearch={() => navigate('/')} />
    </div>
  )
}

function ChevronIcon({ className }: { className?: string }): JSX.Element {
  return (
    <svg
      className={className}
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3.5 5.25L7 8.75l3.5-3.5" />
    </svg>
  )
}
