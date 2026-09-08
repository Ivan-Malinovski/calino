#!/usr/bin/env node
/**
 * Updates sample-events.ics dates to the current month.
 * Run automatically via prebuild hook or manually: node scripts/update-sample-events.mjs
 */

import { readFileSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const rootDir = join(__dirname, '..')
const icsPath = join(rootDir, 'public', 'sample-events.ics')

function pad(num, len = 2) {
  return String(num).padStart(len, '0')
}

function daysInMonth(year, month) {
  // Day 0 of the next month is the last day of this one.
  return new Date(year, month, 0).getDate()
}

function updateICSDate(dateStr) {
  // Handles formats: YYYYMMDD, YYYYMMDDTHHMMSSZ
  if (!dateStr || dateStr.length < 8) return dateStr

  const day = parseInt(dateStr.slice(6, 8), 10)

  const now = new Date()
  const newYear = now.getFullYear()
  const newMonth = now.getMonth() + 1 // 1-indexed

  // Shift to the current month, keeping the day of the month — but clamp it to
  // the target month's length. Carrying a day straight across produced dates
  // that do not exist (a sample event on the 31st landed on "September 31st"),
  // which parsers then roll over into the following month.
  const newDay = Math.min(day, daysInMonth(newYear, newMonth))

  let result = String(newYear) + pad(newMonth) + pad(newDay)

  // Preserve time part if present
  if (dateStr.length > 8) {
    result += dateStr.slice(8)
  }

  return result
}

function processLine(line) {
  // Match date patterns in iCalendar format
  // DTSTART;VALUE=DATE:20260301
  // DTSTART:20260303T100000Z
  // DTEND;VALUE=DATE:20260302
  // DUE;VALUE=DATE:20260305
  // DTSTAMP:20260301T000000Z
  // CREATED:20260301T000000Z
  // COMPLETED:20260303T080000Z

  return line.replace(
    /((?:DTSTART|DTEND|DUE|DTSTAMP|CREATED|COMPLETED)(?:;[^:]*)?):(\d{8})(T\d{6}Z)?/g,
    (match, prefix, datePart, timePart) => {
      const updatedDate = updateICSDate(datePart)
      return `${prefix}:${updatedDate}${timePart || ''}`
    }
  )
}

async function main() {
  const icsContent = readFileSync(icsPath, 'utf-8')

  const now = new Date()
  const currentYear = now.getFullYear()
  const currentMonth = now.getMonth() + 1 // 1-indexed

  // The month the file currently sits in, read from its first date rather than
  // hardcoded: this script rewrites the .ics in place, so the file's own
  // content is the only accurate source month. A fixed "March 2026" constant
  // silently skipped the update whenever the calendar reached that month.
  const firstDate = icsContent.match(
    /(?:DTSTART|DTEND|DUE|DTSTAMP|CREATED|COMPLETED)(?:;[^:\n]*)?:(\d{8})/
  )
  if (!firstDate) {
    console.log('No dates found in sample-events.ics, nothing to update.')
    return
  }
  const sampleYear = parseInt(firstDate[1].slice(0, 4), 10)
  const sampleMonth = parseInt(firstDate[1].slice(4, 6), 10)

  if (sampleYear === currentYear && sampleMonth === currentMonth) {
    console.log(
      `sample-events.ics is already in ${currentMonth}/${currentYear}, no update needed.`
    )
    return
  }

  console.log(
    `Updating sample-events.ics: shifting ${sampleMonth}/${sampleYear} → ${currentMonth}/${currentYear}`
  )

  const updatedContent = icsContent
    .split('\n')
    .map(line => processLine(line))
    .join('\n')

  writeFileSync(icsPath, updatedContent, 'utf-8')
  console.log('Updated sample-events.ics successfully.')
}

main().catch(err => {
  console.error('Error updating sample events:', err)
  process.exit(1)
})
