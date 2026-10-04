import type http from 'node:http'
import type { Plugin } from 'vite'

/**
 * Dev-only Vite plugin that mounts a CardDAV server at `/mock-carddav/*`.
 *
 * It is deliberately written the way Radicale writes its XML: `DAV:` is the
 * *default* namespace and the CardDAV namespace is bound to `CR:`. Calino's
 * parsing used to hardcode the `d:` / `card:` prefixes, so a server like this
 * (issue #173) was the case it could not read. Keep the prefixes unusual.
 *
 * It keeps a real RFC 6578 change log so an incremental-sync spec can tell an
 * incremental sync from a full re-fetch: `sync-collection` with token N answers
 * "everything stamped above N", plus tombstones for deletions.
 *
 * Control endpoints (the spec talking to the mock, not the app):
 *   - POST   /__test__/reset
 *   - PUT    /__test__/put?name=<file.vcf>        body = vCard
 *   - DELETE /__test__/delete?name=<file.vcf>
 *   - GET    /__test__/log                        → [{ method, path, kind?, hrefs? }]
 *   - POST   /__test__/clear-log
 *   - POST   /__test__/short-multiget?count=N     next N multigets omit one card
 */

const MOUNT = '/mock-carddav'
const PRINCIPAL = `${MOUNT}/dav/principals/user/`
const HOME = `${MOUNT}/dav/addressbooks/user/`
const BOOK = `${HOME}book/`
const TOKEN_PREFIX = 'http://calino.test/ns/sync/'

const NS =
  'xmlns="DAV:" xmlns:CR="urn:ietf:params:xml:ns:carddav" xmlns:CS="http://calendarserver.org/ns/"'

interface LoggedRequest {
  method: string
  path: string
  /** For REPORTs: which report it was. */
  kind?: 'sync-collection' | 'addressbook-multiget' | 'addressbook-query'
  /** For multigets: how many hrefs were requested. */
  hrefs?: number
}

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const unesc = (s: string): string =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')

/** Percent-encode a stored file name the way a real server writes hrefs. */
const hrefFor = (name: string): string => `${BOOK}${encodeURIComponent(name)}`

export function carddavMockPlugin(): Plugin {
  if (process.env.CALINO_E2E_MOCK !== '1') {
    return { name: 'calino-carddav-mock', apply: () => false }
  }

  // file name (decoded) → card
  const cards = new Map<string, { vcard: string; etag: string; rev: number }>()
  const tombstones = new Map<string, number>()
  let rev = 0
  let etagCounter = 0
  let shortMultiget = 0
  const log: LoggedRequest[] = []

  const reset = () => {
    cards.clear()
    tombstones.clear()
    log.length = 0
    shortMultiget = 0
    rev += 1
  }
  const put = (name: string, vcard: string) => {
    rev += 1
    cards.set(name, { vcard, etag: `"card-etag-${++etagCounter}"`, rev })
    tombstones.delete(name)
  }
  const remove = (name: string): boolean => {
    if (!cards.delete(name)) return false
    rev += 1
    tombstones.set(name, rev)
    return true
  }

  const readBody = (req: http.IncomingMessage): Promise<string> =>
    new Promise((resolve) => {
      let data = ''
      req.on('data', (chunk) => (data += chunk))
      req.on('end', () => resolve(data))
    })

  // Paths below are relative to the mount, because `middlewares.use(MOUNT, …)` strips it.
  const rel = (absolute: string) => absolute.slice(MOUNT.length)

  const nameFromPath = (path: string): string | null => {
    const prefix = rel(BOOK)
    if (!path.startsWith(prefix)) return null
    const rest = path.slice(prefix.length)
    if (!rest) return null
    try {
      return decodeURIComponent(rest)
    } catch {
      return null
    }
  }

  const multistatus = (responses: string[], syncToken?: string): string =>
    `<?xml version="1.0" encoding="utf-8"?>\n<multistatus ${NS}>${responses.join('')}${
      syncToken ? `<sync-token>${syncToken}</sync-token>` : ''
    }</multistatus>`

  const propResponse = (href: string, props: string) =>
    `<response><href>${esc(href)}</href><propstat><prop>${props}</prop><status>HTTP/1.1 200 OK</status></propstat></response>`

  const goneResponse = (href: string) =>
    `<response><href>${esc(href)}</href><status>HTTP/1.1 404 Not Found</status></response>`

  const bookProps = () =>
    [
      '<resourcetype><collection/><CR:addressbook/></resourcetype>',
      '<displayname>Mock Contacts</displayname>',
      `<CS:getctag>"ctag-${rev}"</CS:getctag>`,
      `<sync-token>${TOKEN_PREFIX}${rev}</sync-token>`,
      '<CR:supported-address-data><CR:address-data-type content-type="text/vcard" version="3.0"/><CR:address-data-type content-type="text/vcard" version="4.0"/></CR:supported-address-data>',
      '<current-user-privilege-set><privilege><read/></privilege><privilege><write/></privilege><privilege><write-content/></privilege><privilege><bind/></privilege><privilege><unbind/></privilege></current-user-privilege-set>',
    ].join('')

  const cardResponse = (name: string, withData: boolean) => {
    const card = cards.get(name)!
    const props =
      `<getetag>${esc(card.etag)}</getetag>` +
      (withData ? `<CR:address-data>${esc(card.vcard)}</CR:address-data>` : '')
    return propResponse(hrefFor(name), props)
  }

  const handler = async (req: http.IncomingMessage, res: http.ServerResponse, next: () => void) => {
    const path = (req.url ?? '/').split('?')[0]
    const query = new URL(req.url ?? '/', 'http://localhost').searchParams
    const method = req.method ?? 'GET'
    const send = (status: number, body = '', type = 'application/xml; charset=utf-8') => {
      res.writeHead(status, { 'Content-Type': type })
      res.end(body)
    }

    // --- control endpoints -------------------------------------------------
    if (path.startsWith('/__test__/')) {
      const endpoint = path.slice('/__test__/'.length)
      if (endpoint === 'reset' && method === 'POST') {
        reset()
        return send(204)
      }
      if (endpoint === 'put' && method === 'PUT') {
        put(query.get('name') ?? 'unnamed.vcf', await readBody(req))
        return send(204)
      }
      if (endpoint === 'delete' && method === 'DELETE') {
        remove(query.get('name') ?? '')
        return send(204)
      }
      if (endpoint === 'log' && method === 'GET') {
        return send(200, JSON.stringify(log), 'application/json')
      }
      if (endpoint === 'clear-log' && method === 'POST') {
        log.length = 0
        return send(204)
      }
      if (endpoint === 'short-multiget' && method === 'POST') {
        shortMultiget = Number(query.get('count') ?? 1)
        return send(204)
      }
      return send(404)
    }

    const entry: LoggedRequest = { method, path }
    log.push(entry)

    // --- discovery ---------------------------------------------------------
    if (path === '/.well-known/carddav') {
      res.writeHead(301, { Location: `${MOUNT}/dav/` })
      return res.end()
    }
    if (method === 'PROPFIND' && (path === '/dav/' || path === '/' || path === '')) {
      return send(
        207,
        multistatus([
          propResponse(
            `${MOUNT}/dav/`,
            `<current-user-principal><href>${PRINCIPAL}</href></current-user-principal>`
          ),
        ])
      )
    }
    if (method === 'PROPFIND' && path === rel(PRINCIPAL)) {
      return send(
        207,
        multistatus([
          propResponse(
            PRINCIPAL,
            `<CR:addressbook-home-set><href>${HOME}</href></CR:addressbook-home-set>`
          ),
        ])
      )
    }
    if (method === 'PROPFIND' && path === rel(HOME)) {
      return send(
        207,
        multistatus([
          propResponse(HOME, '<resourcetype><collection/></resourcetype>'),
          propResponse(BOOK, bookProps()),
        ])
      )
    }
    if (method === 'PROPFIND' && path === rel(BOOK)) {
      return send(207, multistatus([propResponse(BOOK, bookProps())]))
    }

    // --- REPORT ------------------------------------------------------------
    if (method === 'REPORT' && path === rel(BOOK)) {
      const body = await readBody(req)

      if (body.includes('sync-collection')) {
        entry.kind = 'sync-collection'
        const tokenMatch = body.match(/<(?:\w+:)?sync-token>([^<]*)<\//)
        const raw = tokenMatch ? unesc(tokenMatch[1]) : ''
        let since = 0
        if (raw) {
          const n = raw.startsWith(TOKEN_PREFIX) ? Number(raw.slice(TOKEN_PREFIX.length)) : NaN
          if (Number.isNaN(n)) {
            // RFC 6578 §3.2: a token the server cannot answer for.
            return send(403, `<?xml version="1.0"?><error ${NS}><valid-sync-token/></error>`)
          }
          since = n
        }
        const responses: string[] = []
        for (const [name, card] of cards) {
          if (card.rev > since) responses.push(cardResponse(name, false))
        }
        for (const [name, at] of tombstones) {
          if (at > since) responses.push(goneResponse(hrefFor(name)))
        }
        return send(207, multistatus(responses, `${TOKEN_PREFIX}${rev}`))
      }

      if (body.includes('addressbook-multiget')) {
        entry.kind = 'addressbook-multiget'
        const hrefs = [...body.matchAll(/<(?:\w+:)?href>([^<]*)<\//g)].map((m) => unesc(m[1]))
        entry.hrefs = hrefs.length
        const responses: string[] = []
        for (const href of hrefs) {
          let name: string | null
          try {
            name = nameFromPath(rel(decodeURIComponent(href)))
          } catch {
            name = null
          }
          responses.push(name && cards.has(name) ? cardResponse(name, true) : goneResponse(href))
        }
        if (shortMultiget > 0 && responses.length > 0) {
          shortMultiget -= 1
          responses.pop()
        }
        return send(207, multistatus(responses))
      }

      // addressbook-query: the full listing
      entry.kind = 'addressbook-query'
      const withData = body.includes('address-data')
      return send(207, multistatus([...cards.keys()].map((n) => cardResponse(n, withData))))
    }

    // --- resources ---------------------------------------------------------
    const name = nameFromPath(path)
    if (name !== null) {
      if (method === 'PUT') {
        put(name, await readBody(req))
        res.writeHead(201, { ETag: cards.get(name)!.etag })
        return res.end()
      }
      if (method === 'DELETE') return send(remove(name) ? 204 : 404)
      if (method === 'GET') {
        const card = cards.get(name)
        if (!card) return send(404)
        res.writeHead(200, { 'Content-Type': 'text/vcard', ETag: card.etag })
        return res.end(card.vcard)
      }
    }

    if (method === 'OPTIONS') {
      res.writeHead(200, {
        Allow: 'OPTIONS, GET, HEAD, PUT, DELETE, PROPFIND, REPORT',
        DAV: '1, 2, 3, addressbook',
      })
      return res.end()
    }

    next()
  }

  return {
    name: 'calino-carddav-mock',
    configureServer(server) {
      server.middlewares.use(MOUNT, handler)
      console.log(`[calino-carddav-mock] mounted at ${MOUNT}/* (dev only)`)
    },
  }
}
