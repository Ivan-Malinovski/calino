import { useState, useEffect, useCallback } from 'react'
import { config } from '@/config'
import { compareVersions } from '@/lib/version'
import { safeLocalStorage } from '@/lib/storage'

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000 // 24 hours
const STORAGE_KEY_LAST_CHECK = 'calino-last-update-check'
const STORAGE_KEY_DISMISSED = 'calino-dismissed-version'

interface UpdateInfo {
  hasUpdate: boolean
  latestVersion: string | null
  releaseUrl: string | null
  loading: boolean
  error: string | null
  dismiss: () => void
}

function getTimeSinceLastCheck(): number {
  const lastCheck = safeLocalStorage.getItem(STORAGE_KEY_LAST_CHECK)
  if (!lastCheck) return Infinity
  try {
    return Date.now() - new Date(lastCheck).getTime()
  } catch {
    return Infinity
  }
}

function getDismissedVersion(): string | null {
  return safeLocalStorage.getItem(STORAGE_KEY_DISMISSED)
}

function setLastCheckNow(): void {
  safeLocalStorage.setItem(STORAGE_KEY_LAST_CHECK, new Date().toISOString())
}

function setDismissedVersion(version: string): void {
  safeLocalStorage.setItem(STORAGE_KEY_DISMISSED, version)
}

interface GitHubRelease {
  tag_name: string
  html_url: string
}

export function useUpdateCheck(): UpdateInfo {
  const [hasUpdate, setHasUpdate] = useState(false)
  const [latestVersion, setLatestVersion] = useState<string | null>(null)
  const [releaseUrl, setReleaseUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const dismiss = useCallback((): void => {
    if (latestVersion) {
      setDismissedVersion(latestVersion)
    }
    setHasUpdate(false)
  }, [latestVersion])

  useEffect(() => {
    // Skip if we checked within the last 24 hours
    if (getTimeSinceLastCheck() < CHECK_INTERVAL_MS) {
      return
    }

    let cancelled = false

    async function checkForUpdate(): Promise<void> {
      setLoading(true)
      setError(null)

      try {
        const url = `https://api.github.com/repos/${config.githubRepo}/releases/latest`
        const response = await fetch(url, {
          headers: { Accept: 'application/vnd.github+json' },
        })

        if (cancelled) return

        if (response.status === 404) {
          // No releases exist yet — not an error, just no update
          setLastCheckNow()
          return
        }

        if (!response.ok) {
          throw new Error(`GitHub API error: ${response.status}`)
        }

        const data: GitHubRelease = await response.json()
        const tagVersion = data.tag_name

        if (compareVersions(tagVersion, config.appVersion) > 0) {
          // Newer version available
          const dismissedVersion = getDismissedVersion()

          if (dismissedVersion !== tagVersion) {
            // Not dismissed for this version
            setLatestVersion(tagVersion)
            setReleaseUrl(data.html_url)
            setHasUpdate(true)
          } else {
            // Dismissed for this version
            setHasUpdate(false)
          }
        }

        setLastCheckNow()
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? `Failed to check for updates: ${err.message}`
              : 'Failed to check for updates'
          )
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    checkForUpdate()

    return () => {
      cancelled = true
    }
  }, [])

  return { hasUpdate, latestVersion, releaseUrl, loading, error, dismiss }
}
