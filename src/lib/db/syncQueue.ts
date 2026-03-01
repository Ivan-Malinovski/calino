import { db } from './db'
import type { SyncQueueItem, SyncOperation } from '@/types/storage'

export async function addToSyncQueue(
  operation: SyncOperation,
  entity: 'event' | 'calendar',
  entityId: string,
  data?: unknown
): Promise<number> {
  const item: Omit<SyncQueueItem, 'id'> = {
    operation,
    entity,
    entityId,
    data,
    timestamp: new Date().toISOString(),
    retryCount: 0,
  }
  return db.syncQueue.add(item)
}

export async function getSyncQueue(): Promise<SyncQueueItem[]> {
  return db.syncQueue.orderBy('timestamp').toArray()
}

export async function getPendingSyncItems(): Promise<SyncQueueItem[]> {
  return db.syncQueue.orderBy('timestamp').toArray()
}

export async function removeSyncQueueItem(id: number): Promise<void> {
  return db.syncQueue.delete(id)
}

export async function clearSyncQueue(): Promise<void> {
  return db.syncQueue.clear()
}

export async function updateSyncQueueItem(
  id: number,
  updates: Partial<SyncQueueItem>
): Promise<number> {
  return db.syncQueue.update(id, updates)
}

export async function incrementRetryCount(id: number, error?: string): Promise<void> {
  const item = await db.syncQueue.get(id)
  if (item) {
    await db.syncQueue.update(id, {
      retryCount: item.retryCount + 1,
      lastError: error,
    })
  }
}

export async function getSyncQueueCount(): Promise<number> {
  return db.syncQueue.count()
}

export async function getSyncItemsByEntity(
  entity: 'event' | 'calendar',
  entityId: string
): Promise<SyncQueueItem[]> {
  return db.syncQueue.where(['entity', 'entityId']).equals([entity, entityId]).toArray()
}

export async function removeSyncItemsByEntity(
  entity: 'event' | 'calendar',
  entityId: string
): Promise<number> {
  const items = await getSyncItemsByEntity(entity, entityId)
  const ids = items.map((item) => item.id).filter((id): id is number => id !== undefined)
  await db.syncQueue.bulkDelete(ids)
  return ids.length
}

export interface SyncQueueProcessor {
  processItem: (item: SyncQueueItem) => Promise<boolean>
  maxRetries?: number
}

export async function processSyncQueue(processor: SyncQueueProcessor): Promise<{
  processed: number
  failed: number
}> {
  const items = await getPendingSyncItems()
  const maxRetries = processor.maxRetries ?? 3

  let processed = 0
  let failed = 0

  for (const item of items) {
    if (item.id === undefined) continue

    if (item.retryCount >= maxRetries) {
      failed++
      continue
    }

    try {
      const success = await processor.processItem(item)
      if (success) {
        await removeSyncQueueItem(item.id)
        processed++
      } else {
        await incrementRetryCount(item.id, 'Processing failed')
        failed++
      }
    } catch (error) {
      await incrementRetryCount(item.id, error instanceof Error ? error.message : 'Unknown error')
      failed++
    }
  }

  return { processed, failed }
}
