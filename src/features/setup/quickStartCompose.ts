import { argon2idAsync } from '@noble/hashes/argon2.js'
import { QUICK_START_USERNAME, type CalinoConfig } from '@/lib/configLoader'

const memory = 47_104
const iterations = 1
const parallelism = 1
const image = '${CALINO_IMAGE:-ghcr.io/ivan-malinovski/calino:latest}'

function unpaddedBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/=+$/, '')
}

// Compose interpolates dollar signs even in inline config content.
function escapeCompose(value: string): string {
  return value.replaceAll('$', () => '$$')
}

export async function makeQuickStartCompose(
  config: CalinoConfig,
  password: string
): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const digest = await argon2idAsync(password, salt, {
    m: memory,
    t: iterations,
    p: parallelism,
    dkLen: 32,
  })
  const hash = [
    '',
    'argon2id',
    'v=19',
    `m=${memory},t=${iterations},p=${parallelism}`,
    unpaddedBase64(salt),
    unpaddedBase64(digest),
  ].join('$')
  const content = JSON.stringify({ ...config, unlockWithSignIn: true }, null, 2)
    .split('\n')
    .map((line) => `      ${escapeCompose(line)}`)
    .join('\n')

  return `services:
  calino:
    image: "${image}"
    ports:
      - "127.0.0.1:8080:8080"
    environment:
      CALINO_CONFIG_QUICK_START: "true"
      CALINO_CONFIG_AUTH_USER: "${QUICK_START_USERNAME}"
      CALINO_CONFIG_AUTH_ALGORITHM: "argon2id"
      CALINO_CONFIG_AUTH_HASH: "${escapeCompose(hash)}"
    configs:
      - source: calino_config
        target: /calino/calino.config.json
    restart: unless-stopped
configs:
  calino_config:
    content: |-
${content}
`
}
