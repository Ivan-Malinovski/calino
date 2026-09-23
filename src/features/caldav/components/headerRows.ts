import { validateCustomHeaders, type CustomHeaders } from '../client/customHeaders'

export interface HeaderRow {
  name: string
  value: string
}

export function rowsToHeaders(rows: HeaderRow[], proxyUrl?: string | null): CustomHeaders {
  const headers: CustomHeaders = {}
  const names = new Set<string>()
  for (const row of rows) {
    if (!row.name.trim() && !row.value) continue
    const name = row.name.trim()
    if (names.has(name.toLowerCase())) throw new Error(`Duplicate custom header name: ${name}`)
    names.add(name.toLowerCase())
    headers[name] = row.value
  }
  return validateCustomHeaders(headers, proxyUrl)
}
