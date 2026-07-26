import type { WebcalSubscription } from './types'
import { v4 as uuidv4 } from 'uuid'

const SUBSCRIPTIONS_KEY = 'calino_webcal_subscriptions'

export function saveSubscription(
  subscription: Omit<WebcalSubscription, 'id' | 'lastFetchedAt' | 'lastError'>
): WebcalSubscription {
  const subscriptions = getAllSubscriptions()
  const newSubscription: WebcalSubscription = {
    ...subscription,
    id: uuidv4(),
    lastFetchedAt: null,
    lastError: null,
  }
  subscriptions.push(newSubscription)
  localStorage.setItem(SUBSCRIPTIONS_KEY, JSON.stringify(subscriptions))
  return newSubscription
}

export function getAllSubscriptions(): WebcalSubscription[] {
  const stored = localStorage.getItem(SUBSCRIPTIONS_KEY)
  if (!stored) {
    return []
  }
  try {
    return JSON.parse(stored) as WebcalSubscription[]
  } catch {
    console.warn(
      '[Webcal] Failed to parse stored subscriptions from localStorage. Data may be corrupted.'
    )
    return []
  }
}

export function getSubscriptionById(id: string): WebcalSubscription | undefined {
  return getAllSubscriptions().find((s) => s.id === id)
}

export function updateSubscription(id: string, updates: Partial<WebcalSubscription>): void {
  const subscriptions = getAllSubscriptions()
  const index = subscriptions.findIndex((s) => s.id === id)
  if (index !== -1) {
    subscriptions[index] = { ...subscriptions[index], ...updates }
    localStorage.setItem(SUBSCRIPTIONS_KEY, JSON.stringify(subscriptions))
  }
}

export function deleteSubscription(id: string): void {
  const subscriptions = getAllSubscriptions()
  const filtered = subscriptions.filter((s) => s.id !== id)
  localStorage.setItem(SUBSCRIPTIONS_KEY, JSON.stringify(filtered))
}
