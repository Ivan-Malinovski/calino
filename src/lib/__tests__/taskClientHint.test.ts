import { describe, it, expect } from 'vitest'
import { detectClientFromProdid } from '../taskClientHint'

const clientFiles = import.meta.glob<string>('./rolling-fixtures/clients/*/*/{before,after}/*.ics', {
  query: '?raw',
  import: 'default',
  eager: true,
})

describe('detectClientFromProdid', () => {
  it('detects OpenTasks', () => {
    expect(detectClientFromProdid('DAVx5/4.5.21-ose ical4j/4.3.0 (org.dmfs.tasks)')).toBe('OpenTasks')
  })

  it('detects Tasks.org', () => {
    expect(detectClientFromProdid('DAVx5/4.5.21-ose ical4j/4.3.0 (org.tasks)')).toBe('Tasks.org')
    expect(detectClientFromProdid('+//IDN tasks.org//android-151202//EN')).toBe('Tasks.org')
  })

  it('returns null for unknown', () => {
    expect(detectClientFromProdid('-//Calino//EN')).toBeNull()
  })

  it('matches real fixtures', () => {
    // Check Tasks.org direct
    const tasksOrg = clientFiles['./rolling-fixtures/clients/tasks-org/daily/after/1.ics']
    const tasksOrgMatch = tasksOrg?.match(/PRODID:(.+)/)?.[1]?.trim()
    expect(detectClientFromProdid(tasksOrgMatch)).toBe('Tasks.org')

    // Check OpenTasks
    const openTasks = clientFiles['./rolling-fixtures/clients/davx5-opentasks/daily/after/1.ics']
    const openTasksMatch = openTasks?.match(/PRODID:(.+)/)?.[1]?.trim()
    expect(detectClientFromProdid(openTasksMatch)).toBe('OpenTasks')

    // Check Tasks.org via DAVx5
    const davx5TasksOrg = clientFiles['./rolling-fixtures/clients/davx5-tasks-org/daily/after/1.ics']
    const davx5TasksOrgMatch = davx5TasksOrg?.match(/PRODID:(.+)/)?.[1]?.trim()
    expect(detectClientFromProdid(davx5TasksOrgMatch)).toBe('Tasks.org')
  })
})
