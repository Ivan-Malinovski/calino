/**
 * RFC 7617 Basic auth header with UTF-8 credentials.
 *
 * `btoa()` only accepts Latin-1: a password with `é` encodes the wrong bytes
 * (Latin-1 codepoint instead of the UTF-8 sequence the server expects), and
 * `密码`/emoji throw `InvalidCharacterError` outright. RFC 7617 says the
 * default charset for Basic is UTF-8, so encode the `user:pass` string as
 * UTF-8 bytes before base64.
 */
export function basicAuthHeader(username: string, password: string): string {
  const bytes = new TextEncoder().encode(`${username}:${password}`)
  let binary = ''
  // Chunked String.fromCharCode avoids blowing the argument limit on long
  // passwords.
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return `Basic ${btoa(binary)}`
}
