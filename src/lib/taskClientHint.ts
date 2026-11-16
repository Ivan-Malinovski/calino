export type ClientHint = 'Tasks.org' | 'OpenTasks' | null

export function detectClientFromProdid(prodid?: string | null): ClientHint {
  if (!prodid) return null

  if (/\(org\.tasks\)/.test(prodid) || /tasks\.org/i.test(prodid)) {
    return 'Tasks.org'
  }

  if (/\(org\.dmfs\.tasks\)/.test(prodid)) {
    return 'OpenTasks'
  }

  // Apple Reminders is not detected yet.

  return null
}
