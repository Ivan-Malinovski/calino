import { describe, it, expect } from 'vitest'
import { parseExtractedCandidates, parseVisionProbeReply } from '../prompt'
import { AIVisionExtractionError } from '../types'

describe('parseExtractedCandidates', () => {
  it('parses a clean JSON array', () => {
    const raw = '[{"title":"Block Party","location":"Main St","start":"2026-07-25T18:00"}]'
    expect(parseExtractedCandidates(raw)).toEqual([
      {
        title: 'Block Party',
        location: 'Main St',
        start: '2026-07-25T18:00',
      },
    ])
  })

  it('wraps a bare JSON object in an array (tolerates non-array replies)', () => {
    const raw = '{"title":"Gig Night","confidence":"high"}'
    expect(parseExtractedCandidates(raw)).toEqual([{ title: 'Gig Night', confidence: 'high' }])
  })

  it('parses multiple candidates', () => {
    const raw = '[{"title":"Show","start":"2026-08-01T19:00"},{"title":"Show","start":"2026-08-02T19:00"}]'
    expect(parseExtractedCandidates(raw)).toEqual([
      { title: 'Show', start: '2026-08-01T19:00' },
      { title: 'Show', start: '2026-08-02T19:00' },
    ])
  })

  it('parses JSON wrapped in ```json fences', () => {
    const raw = '```json\n[{"title":"Gig Night","confidence":"high"}]\n```'
    expect(parseExtractedCandidates(raw)).toEqual([{ title: 'Gig Night', confidence: 'high' }])
  })

  it('parses JSON wrapped in plain ``` fences', () => {
    const raw = '```\n[{"title":"Yard Sale"}]\n```'
    expect(parseExtractedCandidates(raw)).toEqual([{ title: 'Yard Sale' }])
  })

  it('salvages a JSON array from surrounding prose', () => {
    const raw = 'Sure, here is the JSON:\n[{"title":"Farmers Market","allDay":true}]\nHope that helps!'
    expect(parseExtractedCandidates(raw)).toEqual([{ title: 'Farmers Market', allDay: true }])
  })

  it('salvages a bare JSON object from surrounding prose', () => {
    const raw = 'Sure, here is the JSON:\n{"title":"Farmers Market","allDay":true}\nHope that helps!'
    expect(parseExtractedCandidates(raw)).toEqual([{ title: 'Farmers Market', allDay: true }])
  })

  it('drops unknown keys and invalid field types', () => {
    const raw = '[{"title":"Ok","unknownField":"x","allDay":"yes","confidence":"extreme"}]'
    expect(parseExtractedCandidates(raw)).toEqual([{ title: 'Ok' }])
  })

  it('throws AIVisionExtractionError on garbage text', () => {
    const raw = 'I cannot help with that.'
    expect(() => parseExtractedCandidates(raw)).toThrow(AIVisionExtractionError)
  })

  it('throws AIVisionExtractionError on empty string', () => {
    expect(() => parseExtractedCandidates('')).toThrow(AIVisionExtractionError)
  })

  it('returns a single-item array containing an empty object for a valid empty JSON object', () => {
    expect(parseExtractedCandidates('{}')).toEqual([{}])
  })

  it('caps candidates at 5', () => {
    const raw = JSON.stringify(Array.from({ length: 8 }, (_, i) => ({ title: `Event ${i}` })))
    expect(parseExtractedCandidates(raw)).toHaveLength(5)
  })
})

describe('parseVisionProbeReply', () => {
  it('returns true for a plain YES', () => {
    expect(parseVisionProbeReply('YES')).toBe(true)
  })

  it('returns true for "Yes." with punctuation', () => {
    expect(parseVisionProbeReply('Yes.')).toBe(true)
  })

  it('returns true for a sentence containing yes', () => {
    expect(parseVisionProbeReply('Yes, I can see an image.')).toBe(true)
  })

  it('returns false for a plain NO', () => {
    expect(parseVisionProbeReply('NO')).toBe(false)
  })

  it('returns false for a sentence containing no', () => {
    expect(parseVisionProbeReply('No, I cannot see any image.')).toBe(false)
  })

  it('returns false for unrelated text', () => {
    expect(parseVisionProbeReply('I am not sure what you mean.')).toBe(false)
  })
})
