import { UAParser } from 'ua-parser-js';

export interface ParsedUa {
  browserName: string | null;
  browserVersion: string | null;
  osName: string | null;
  deviceType: string;
}

export function parseUa(ua: string | undefined): ParsedUa {
  if (!ua) return { browserName: null, browserVersion: null, osName: null, deviceType: 'unknown' };
  const parsed = new UAParser(ua).getResult();
  return {
    browserName: parsed.browser.name ?? null,
    browserVersion: parsed.browser.major ?? parsed.browser.version ?? null,
    osName: parsed.os.name ?? null,
    deviceType: parsed.device.type ?? 'desktop'
  };
}
