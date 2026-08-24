import type { JSX } from 'react'
import { useEffect } from 'react'
import { useCardDAV } from '@/features/carddav/hooks/useCardDAV'
import { AIPhotoImportRoot } from '@/features/aiVision/components/AIPhotoImportRoot'
import { useNativeKeyboard } from '@/hooks/useNativeKeyboard'
import { useNotifications } from '@/hooks/useNotifications'
import { useCalendarMirror } from '@/hooks/useCalendarMirror'
import { initContactPhotos } from '@/lib/contactPhotoSync'
import { pruneRawIcs } from '@/lib/rawIcsStore'

/** Calendar integrations that can safely initialize after the first paint. */
export default function DeferredCalendarIntegrations(): JSX.Element {
  useCardDAV()

  useEffect(() => {
    void initContactPhotos()
    void pruneRawIcs().catch(() => {})
  }, [])

  // Mirror status must exist before notifications decide who schedules them.
  useCalendarMirror()
  useNotifications()
  useNativeKeyboard()

  return <AIPhotoImportRoot />
}
