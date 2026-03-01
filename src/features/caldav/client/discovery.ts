import { createDAVClient } from 'tsdav';
import type { ServerInfo } from '../types';

const WELL_KNOWN_PATH = '/.well-known/caldav';
const COMMON_PATHS = [
  '/caldav.php',
  '/caldav',
  '/dav/calendars',
  '/dav/caldav',
  '/calendar/dav',
  '/principals/users',
];

export async function discoverServerUrl(baseUrl: string): Promise<string> {
  const normalizedUrl = normalizeUrl(baseUrl);

  const wellKnownUrl = new URL(WELL_KNOWN_PATH, normalizedUrl).href;
  try {
    const response = await fetch(wellKnownUrl, {
      method: 'OPTIONS',
    });
    if (response.ok || response.status === 401) {
      return wellKnownUrl.replace(/\/$/, '');
    }
  } catch { /* Server not found at well-known path */ }

  for (const path of COMMON_PATHS) {
    const tryUrl = new URL(path, normalizedUrl).href;
    try {
      const response = await fetch(tryUrl, {
        method: 'OPTIONS',
      });
      if (response.ok || response.status === 401) {
        return tryUrl.replace(/\/$/, '');
      }
    } catch {
      continue;
    }
  }

  return normalizedUrl.replace(/\/$/, '');
}

export async function getServerInfo(
  serverUrl: string,
  credentials: { username: string; password: string }
): Promise<ServerInfo> {
  try {
    await createDAVClient({
      serverUrl,
      credentials: {
        username: credentials.username,
        password: credentials.password,
      },
      authMethod: 'Basic',
      defaultAccountType: 'caldav',
    });

    const productId = 'GoodCal Client';
    const capabilities: string[] = [];

    return {
      url: serverUrl,
      productId,
      capabilities,
    };
  } catch (error) {
    throw new Error(`Failed to connect to server: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export async function testConnection(
  serverUrl: string,
  credentials: { username: string; password: string }
): Promise<boolean> {
  try {
    const client = await createDAVClient({
      serverUrl,
      credentials: {
        username: credentials.username,
        password: credentials.password,
      },
      authMethod: 'Basic',
      defaultAccountType: 'caldav',
    });

    await client.fetchCalendars();
    return true;
  } catch {
    return false;
  }
}

function normalizeUrl(url: string): string {
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return `https://${url}`;
  }
  return url;
}
