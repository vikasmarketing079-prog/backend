import { URL } from 'url';

const TRACKING_PARAMS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'fbclid',
  'gclid',
  'msclkid',
  '_ga',
  '_gl',
];

const STATIC_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.ico', '.bmp', '.tiff',
  '.mp4', '.webm', '.ogg', '.mp3', '.wav', '.flac', '.aac',
  '.pdf', '.zip', '.tar', '.gz', '.7z', '.rar', '.exe', '.dmg', '.pkg',
  '.css', '.js', '.map', '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.xml', '.json', '.txt',
]);

/**
 * Normalizes a URL for consistent crawling and deduplication.
 */
export function normalizeUrl(rawUrl: string, baseUrl?: string): string | null {
  try {
    let resolved: URL;
    if (baseUrl) {
      resolved = new URL(rawUrl, baseUrl);
    } else {
      resolved = new URL(rawUrl);
    }

    // Only allow http and https
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') {
      return null;
    }

    // Remove hash/fragment
    resolved.hash = '';

    // Remove marketing tracking params
    for (const param of TRACKING_PARAMS) {
      resolved.searchParams.delete(param);
    }

    // Sort query parameters for consistency
    resolved.searchParams.sort();

    // Standardize trailing slashes for paths other than root
    let pathname = resolved.pathname;
    if (pathname.length > 1 && pathname.endsWith('/')) {
      pathname = pathname.slice(0, -1);
    }
    resolved.pathname = pathname;

    return resolved.href;
  } catch {
    return null;
  }
}

/**
 * Determines whether a URL is on the exact same root domain / origin.
 */
export function isSameOriginOrDomain(candidateUrl: string, baseOrigin: string): boolean {
  try {
    const candidate = new URL(candidateUrl);
    const base = new URL(baseOrigin);

    // Exact hostname match or www variation
    const candHost = candidate.hostname.replace(/^www\./, '').toLowerCase();
    const baseHost = base.hostname.replace(/^www\./, '').toLowerCase();

    return candHost === baseHost;
  } catch {
    return false;
  }
}

/**
 * Checks whether a URL points to a static media or binary asset rather than an HTML page.
 */
export function isStaticResource(urlStr: string): boolean {
  try {
    const parsed = new URL(urlStr);
    const pathname = parsed.pathname.toLowerCase();
    const ext = pathname.substring(pathname.lastIndexOf('.'));
    return STATIC_EXTENSIONS.has(ext);
  } catch {
    return false;
  }
}

