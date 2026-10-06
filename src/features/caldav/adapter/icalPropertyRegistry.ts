import ICAL from 'ical.js'

/**
 * Helpers for scalar iCalendar properties that ical.js does not know about.
 *
 * Originally contributed by Al Franco (https://github.com/al-franco-data/calino,
 * commits 55980d0 and 75dfbec) and adapted for upstream.
 */

export interface ICalendarScalarPropertyDefinition {
  name: string
  defaultType: string
  repeatable?: boolean
}

/**
 * Register an iCalendar property that ical.js does not yet know about.
 *
 * Without a registration ical.js treats the value as TEXT and escapes commas,
 * which corrupts URIs such as `tag:example.com,2026:x`. Suitable for scalar
 * properties, including repeatable ones written as separate lines. Structured
 * and delimiter-multivalue properties need dedicated handlers.
 */
export function registerScalarProperty(definition: ICalendarScalarPropertyDefinition): void {
  const name = definition.name.toLowerCase()

  if (!ICAL.design.icalendar.property[name]) {
    ICAL.design.icalendar.property[name] = {
      defaultType: definition.defaultType,
    }
  }
}

/**
 * RFC 9253 §8.1 — CONCEPT: a URI-valued formal category, allowed zero or more
 * times in any iCalendar component, with only IANA and non-standard parameters.
 */
export const CONCEPT_PROPERTY: ICalendarScalarPropertyDefinition = {
  name: 'concept',
  defaultType: 'uri',
  repeatable: true,
}

registerScalarProperty(CONCEPT_PROPERTY)

/** Read every occurrence of a scalar property, trimmed, blanks and duplicates dropped. */
export function readScalarProperties(component: ICAL.Component, propertyName: string): string[] {
  const values: string[] = []

  for (const prop of component.getAllProperties(propertyName.toLowerCase())) {
    const value = prop.getFirstValue()
    if (typeof value !== 'string') continue

    const trimmed = value.trim()
    if (trimmed.length > 0 && !values.includes(trimmed)) values.push(trimmed)
  }

  return values
}

/**
 * Replace the occurrences of a modeled scalar property with `values`.
 *
 * Existing lines whose value is still wanted are kept as-is so their
 * parameters (IANA or X- params Calino doesn't model) survive a save. Lines
 * no longer wanted are removed; new values are appended.
 */
export function writeScalarProperties(
  component: ICAL.Component,
  propertyName: string,
  values: readonly string[]
): void {
  const name = propertyName.toLowerCase()
  const wanted: string[] = []
  for (const value of values) {
    const trimmed = value.trim()
    if (trimmed && !wanted.includes(trimmed)) wanted.push(trimmed)
  }

  const kept = new Set<string>()
  for (const prop of component.getAllProperties(name)) {
    const current = prop.getFirstValue()
    const trimmed = typeof current === 'string' ? current.trim() : undefined
    if (trimmed !== undefined && wanted.includes(trimmed) && !kept.has(trimmed)) {
      kept.add(trimmed)
    } else {
      component.removeProperty(prop)
    }
  }

  for (const value of wanted) {
    if (kept.has(value)) continue
    const prop = new ICAL.Property(name, component)
    prop.setValue(value)
    component.addProperty(prop)
  }
}
