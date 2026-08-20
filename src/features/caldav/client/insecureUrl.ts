/**
 * Whether a server URL will send credentials and calendar data in the clear.
 *
 * The app permits cleartext HTTP on purpose — self-hosted servers on a private
 * network or behind a VPN often can't get a publicly trusted certificate (see
 * android/app/src/main/res/xml/network_security_config.xml). That makes the
 * warning the only thing standing between a typo'd `http://` and a password
 * sent in plaintext over an untrusted network, so it belongs next to the field.
 *
 * Loopback is exempt: it never leaves the device.
 */
export function isCleartextUrl(serverUrl: string): boolean {
  const trimmed = serverUrl.trim()
  if (!trimmed) return false
  try {
    const { protocol, hostname } = new URL(trimmed)
    if (protocol !== 'http:') return false
    return hostname !== 'localhost' && hostname !== '127.0.0.1' && hostname !== '[::1]'
  } catch {
    return false
  }
}

export const CLEARTEXT_WARNING =
  'This connects over plain HTTP, so your password and calendar data travel unencrypted. Fine on a private network or VPN — avoid it on Wi-Fi you don’t control.'
