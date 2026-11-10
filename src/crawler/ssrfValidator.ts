import dns from 'dns/promises';
import { URL } from 'url';
import ipRangeCheck from 'ip';

const PRIVATE_IPV4_RANGES = [
  '0.0.0.0/8',
  '10.0.0.0/8',
  '127.0.0.0/8',
  '169.254.0.0/16', // Cloud metadata service (169.254.169.254) & link-local
  '172.16.0.0/12',
  '192.168.0.0/16',
  '100.64.0.0/10',
  '198.18.0.0/15',
  '224.0.0.0/4',
  '240.0.0.0/4',
];

const BLOCKED_HOSTNAMES = [
  'localhost',
  '127.0.0.1',
  '::1',
  'metadata.google.internal',
  'instance-data',
  'kubernetes.default.svc',
];

export interface SSRFValidationResult {
  isValid: boolean;
  reason?: string;
  resolvedIp?: string;
  normalizedUrl?: string;
}

/**
 * Checks whether an IP address is in a private, loopback, or reserved range.
 */
export function isPrivateIp(ipAddress: string): boolean {
  try {
    const trimmed = ipAddress.trim().toLowerCase();

    // Loopback & any
    if (trimmed === '::1' || trimmed === '0.0.0.0' || trimmed === '127.0.0.1') {
      return true;
    }

    // IPv6 checks
    if (trimmed.includes(':')) {
      if (
        trimmed.startsWith('fe80:') || // link-local
        trimmed.startsWith('fc00:') || // unique local
        trimmed.startsWith('fd00:') || // unique local
        trimmed.startsWith('::ffff:127.') || // mapped loopback
        trimmed.startsWith('::ffff:10.') ||
        trimmed.startsWith('::ffff:192.168.') ||
        trimmed.startsWith('::ffff:169.254.')
      ) {
        return true;
      }
      return false; // Valid public IPv6
    }

    // IPv4 checks
    for (const range of PRIVATE_IPV4_RANGES) {
      if (ipRangeCheck.cidrSubnet(range).contains(trimmed)) {
        return true;
      }
    }

    if (ipRangeCheck.isPrivate(trimmed) || ipRangeCheck.isLoopback(trimmed)) {
      return true;
    }

    return false;
  } catch {
    return true; // fail-closed if malformed IP
  }
}

/**
 * Validates a user-supplied URL against SSRF attacks.
 */
export async function validateUrlForSSRF(rawUrl: string): Promise<SSRFValidationResult> {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return { isValid: false, reason: 'URL cannot be empty' };
  }

  let formattedUrl = rawUrl.trim();

  // If protocol is specified but disallowed (e.g. ftp://, file://, gopher://)
  if (/^[a-zA-Z0-9+.-]+:\/\//.test(formattedUrl)) {
    if (!formattedUrl.startsWith('http://') && !formattedUrl.startsWith('https://')) {
      return {
        isValid: false,
        reason: 'Disallowed URL protocol. Only HTTP and HTTPS are permitted.',
      };
    }
  } else {
    // If no protocol was provided, default to https://
    formattedUrl = 'https://' + formattedUrl;
  }

  let parsed: URL;
  try {
    parsed = new URL(formattedUrl);
  } catch {
    return { isValid: false, reason: 'Invalid URL format' };
  }

  // Scheme validation - only HTTP and HTTPS allowed
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      isValid: false,
      reason: `Disallowed URL protocol: ${parsed.protocol}. Only HTTP and HTTPS are permitted.`,
    };
  }

  const hostname = parsed.hostname.toLowerCase().trim();

  // Hostname blacklist check
  if (BLOCKED_HOSTNAMES.includes(hostname) || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
    return { isValid: false, reason: 'Access to private or local hostnames is forbidden.' };
  }

  // DNS resolution check
  try {
    const addresses = await dns.lookup(hostname, { all: true });

    if (!addresses || addresses.length === 0) {
      return { isValid: false, reason: `Could not resolve hostname: ${hostname}` };
    }

    for (const record of addresses) {
      if (isPrivateIp(record.address)) {
        return {
          isValid: false,
          reason: `Resolved IP address ${record.address} is within a restricted private/local network range.`,
        };
      }
    }

    return {
      isValid: true,
      resolvedIp: addresses[0].address,
      normalizedUrl: parsed.origin + parsed.pathname + parsed.search,
    };
  } catch (error: any) {
    return {
      isValid: false,
      reason: `DNS resolution failed for hostname "${hostname}": ${error.message || 'Host not found'}`,
    };
  }
}
