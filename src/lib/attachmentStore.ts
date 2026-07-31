/**
 * IndexedDB-backed storage for calendar event attachments.
 * Keeps large base64 data out of localStorage (which has a ~5-10MB quota).
 */

import Dexie, { type EntityTable } from 'dexie'
import type { CalendarAttachment } from '@/types'

interface AttachmentRecord {
  eventId: string
  attachments: CalendarAttachment[]
}

class AttachmentDatabase extends Dexie {
  attachments!: EntityTable<AttachmentRecord, 'eventId'>

  constructor() {
    super('calino-attachments')
    this.version(1).stores({
      attachments: 'eventId',
    })
  }
}

const db = new AttachmentDatabase()

/**
 * Store attachments for an event. Overwrites any existing attachments.
 */
export async function putAttachments(
  eventId: string,
  attachments: CalendarAttachment[]
): Promise<void> {
  await db.attachments.put({ eventId, attachments })
}

/**
 * Retrieve attachments for an event. Returns empty array if none found.
 */
export async function getAttachments(eventId: string): Promise<CalendarAttachment[]> {
  const record = await db.attachments.get(eventId)
  return record?.attachments ?? []
}

/**
 * Delete attachments for an event.
 */
export async function deleteAttachments(eventId: string): Promise<void> {
  await db.attachments.delete(eventId)
}

