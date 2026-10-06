import { format } from 'date-fns'
import { RRule } from 'rrule'
import type { Options } from 'rrule'
import i18n, { currentLanguage } from '@/lib/i18n'
import { getDateFnsLocale } from '@/lib/datetime'

/**
 * Localised recurrence descriptions.
 *
 * `RRule.toText()` only speaks English, and its sentence order can't be
 * rearranged for other languages, so non-English UI languages get a sentence
 * assembled from translated phrases here. Rules this builder doesn't model
 * (BYSETPOS, BYWEEKNO, BYYEARDAY, BYHOUR, ...) return `null` so the caller can
 * fall back to `toText()` rather than describe them wrongly.
 */

const UNITS: Record<number, string> = {
  [RRule.YEARLY]: 'year',
  [RRule.MONTHLY]: 'month',
  [RRule.WEEKLY]: 'week',
  [RRule.DAILY]: 'day',
  [RRule.HOURLY]: 'hour',
  [RRule.MINUTELY]: 'minute',
  [RRule.SECONDLY]: 'second',
}

const UNSUPPORTED: (keyof Options)[] = [
  'bysetpos',
  'byweekno',
  'byyearday',
  'byeaster',
  'byhour',
  'byminute',
  'bysecond',
]

const NTH_KEYS: Record<number, string> = {
  1: 'first',
  2: 'second',
  3: 'third',
  4: 'fourth',
  [-1]: 'last',
}

function asArray<T>(value: T | T[] | null | undefined): T[] {
  if (value === null || value === undefined) return []
  return Array.isArray(value) ? value : [value]
}

function joinList(items: string[]): string {
  try {
    return new Intl.ListFormat(currentLanguage(), { style: 'long', type: 'conjunction' }).format(
      items
    )
  } catch {
    return items.join(', ')
  }
}

/** rrule numbers weekdays from Monday = 0; JS (and date-fns) from Sunday = 0. */
function weekdayName(rruleWeekday: number): string {
  const jsDay = (rruleWeekday + 1) % 7
  // 2024-01-07 is a Sunday.
  return format(new Date(2024, 0, 7 + jsDay), 'EEEE', { locale: getDateFnsLocale() })
}

function monthName(month: number): string {
  return format(new Date(2024, month - 1, 1), 'LLLL', { locale: getDateFnsLocale() })
}

/** Italian is the one shipped language where a weekday (domenica) is feminine. */
function weekdayContext(rruleWeekday: number): string | undefined {
  return rruleWeekday === 6 ? 'feminine' : undefined
}

export function describeRuleLocalised(rruleBody: string): string | null {
  if (currentLanguage() === 'en') return null
  let options: Partial<Options>
  try {
    options = RRule.fromString(`RRULE:${rruleBody}`).origOptions
  } catch {
    return null
  }
  if (UNSUPPORTED.some((key) => asArray(options[key] as number | number[] | undefined).length)) {
    return null
  }
  const unit = options.freq === undefined ? undefined : UNITS[options.freq]
  if (!unit) return null

  const interval = options.interval ?? 1
  const t = (key: string, opts?: Record<string, unknown>): string =>
    i18n.t(`calendar:ui.rrule.${key}`, opts)

  const weekdays = asArray(options.byweekday).map((day) => {
    if (typeof day === 'number') return { weekday: day, n: undefined }
    if (typeof day === 'string') return { weekday: RRule[day].weekday, n: undefined }
    return { weekday: day.weekday, n: day.n }
  })
  const monthDays = asArray(options.bymonthday)
  const months = asArray(options.bymonth)

  const isWeekdaysOnly =
    options.freq === RRule.WEEKLY &&
    interval === 1 &&
    weekdays.length === 5 &&
    weekdays.every((day) => day.n === undefined && day.weekday <= 4)

  let text = isWeekdaysOnly ? t('everyWeekday') : t(`every.${unit}`, { count: interval })

  if (!isWeekdaysOnly && weekdays.length > 0) {
    const nth = weekdays.filter((day) => day.n)
    if (nth.length === 1 && weekdays.length === 1) {
      const { weekday, n } = nth[0]
      const nthKey = n !== undefined ? NTH_KEYS[n] : undefined
      if (!nthKey) return null
      const context = weekdayContext(weekday)
      text = t('withNth', {
        context,
        base: text,
        nth: t(`nth.${nthKey}`, { context }),
        weekday: weekdayName(weekday),
      })
    } else if (nth.length === 0) {
      text = t('withDays', {
        base: text,
        days: joinList(weekdays.map((d) => weekdayName(d.weekday))),
      })
    } else {
      return null
    }
  }

  if (months.length > 0) {
    text = t('withMonth', { base: text, months: joinList(months.map(monthName)) })
  }

  if (monthDays.length > 0) {
    text = monthDays.every((day) => day === -1)
      ? t('withLastDay', { base: text })
      : monthDays.some((day) => day < 1)
        ? ''
        : t('withMonthDay', { base: text, days: joinList(monthDays.map(String)) })
    if (!text) return null
  }

  if (options.until) {
    // The caller rewrites UNTIL to a floating date; rrule parses that as UTC
    // midnight, so read it back with UTC getters.
    const until = new Date(options.until)
    const local = new Date(until.getUTCFullYear(), until.getUTCMonth(), until.getUTCDate())
    text = t('until', { text, date: format(local, 'PPP', { locale: getDateFnsLocale() }) })
  } else if (options.count) {
    text = t('count', { text, count: options.count })
  }

  return text.charAt(0).toUpperCase() + text.slice(1)
}
