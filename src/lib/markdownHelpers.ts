/** Wrap a textarea selection in a Markdown marker without losing its caret. */
export function wrapMarkdownSelection(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  marker: string
): { value: string; selectionStart: number; selectionEnd: number } {
  const before = value.slice(0, selectionStart)
  const selected = value.slice(selectionStart, selectionEnd)
  const after = value.slice(selectionEnd)
  const wrapped = `${marker}${selected || 'text'}${marker}`
  const nextValue = `${before}${wrapped}${after}`
  const nextStart = selectionStart + marker.length
  const nextEnd = nextStart + (selected ? selected.length : 4)
  return { value: nextValue, selectionStart: nextStart, selectionEnd: nextEnd }
}
