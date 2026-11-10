import tls from 'tls';
import { URL } from 'url';
import * as cheerio from 'cheerio';
import { AnalyzerIssue } from './seoAnalyzer.js';

export interface SslCertInfo {
  valid: boolean;
  issuer?: string;
  subject?: string;
  validFrom?: string;
  validTo?: string;
  daysRemaining?: number;
  error?: string;
}

export interface SecurityAnalysisResult {
  score: number;
  issues: AnalyzerIssue[];
  details: {
    isHttps: boolean;
    sslCert?: SslCertInfo;
    hasHsts: boolean;
    hasCsp: boolean;
    hasXFrame: boolean;
    hasXContentType: boolean;
    hasReferrerPolicy: boolean;
    hasPermissionsPolicy: boolean;
    mixedContentFound: number;
    mixedContentExamples: string[];
    insecureCookieCount: number;
  };
}

/**
 * Non-invasive TLS certificate inspection using native Node tls.connect
 */
export async function inspectSslCertificate(hostname: string, port = 443): Promise<SslCertInfo> {
  return new Promise((resolve) => {
    try {
      const socket = tls.connect(
        {
          host: hostname,
          port,
          servername: hostname,
          timeout: 7000,
          rejectUnauthorized: false, // Inspect cert even if self-signed or expired to report exact issue
        },
        () => {
          const cert = socket.getPeerCertificate(true);
          const authorized = socket.authorized;
          const authError = socket.authorizationError ? String(socket.authorizationError) : undefined;
          socket.destroy();

          if (!cert || Object.keys(cert).length === 0) {
            return resolve({
              valid: false,
              error: 'No SSL certificate returned by host.',
            });
          }

          const validTo = new Date(cert.valid_to);
          const validFrom = new Date(cert.valid_from);
          const now = new Date();
          const daysRemaining = Math.round((validTo.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

          const rawIssuer = cert.issuer?.O || cert.issuer?.CN;
          const issuerStr = Array.isArray(rawIssuer) ? rawIssuer.join(', ') : (rawIssuer || 'Unknown CA');
          const rawSubject = cert.subject?.CN;
          const subjectStr = Array.isArray(rawSubject) ? rawSubject.join(', ') : (rawSubject || hostname);

          resolve({
            valid: authorized && daysRemaining > 0,
            issuer: issuerStr,
            subject: subjectStr,
            validFrom: validFrom.toISOString(),
            validTo: validTo.toISOString(),
            daysRemaining,
            error: authError,
          });
        }
      );

      socket.on('error', (err) => {
        resolve({
          valid: false,
          error: `TLS handshake error: ${err.message}`,
        });
      });

      socket.on('timeout', () => {
        socket.destroy();
        resolve({
          valid: false,
          error: 'Connection timed out while inspecting SSL certificate.',
        });
      });
    } catch (e: any) {
      resolve({
        valid: false,
        error: e.message,
      });
    }
  });
}

/**
 * Analyzes security posture non-invasively
 */
export async function analyzeSecurity(
  url: string,
  html: string,
  headers: Record<string, string | string[] | undefined>
): Promise<SecurityAnalysisResult> {
  const issues: AnalyzerIssue[] = [];
  let score = 100;
  const parsedUrl = new URL(url);
  const isHttps = parsedUrl.protocol === 'https:';

  // Normalize headers
  const h: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    h[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : (v || '');
  }

  // 1. HTTPS Protocol Check
  if (!isHttps) {
    score -= 35;
    issues.push({
      category: 'security',
      severity: 'critical',
      issueCode: 'SEC_NO_HTTPS',
      title: 'Website Not Served Over Secure HTTPS',
      url,
      evidence: `Page served over unencrypted HTTP protocol: ${url}.`,
      whyItMatters:
        'Unencrypted HTTP traffic can be intercepted, read, or modified by attackers on public Wi-Fi networks (man-in-the-middle attacks). Major browsers mark HTTP pages as "Not Secure".',
      recommendation:
        'Install a free TLS certificate (e.g. Let’s Encrypt) and redirect all HTTP traffic to HTTPS.',
      priorityScore: 98,
    });
  }

  // 2. SSL Certificate Details (if HTTPS)
  let sslCert: SslCertInfo | undefined;
  if (isHttps) {
    sslCert = await inspectSslCertificate(parsedUrl.hostname);
    if (!sslCert.valid) {
      score -= 30;
      issues.push({
        category: 'security',
        severity: 'critical',
        issueCode: 'SEC_INVALID_SSL_CERTIFICATE',
        title: 'Invalid or Untrusted SSL Certificate',
        url,
        evidence: `SSL inspection failed: ${sslCert.error || 'Certificate expired or self-signed'}.`,
        whyItMatters:
          'Browsers block users from visiting sites with invalid or expired SSL certificates with full-screen security warnings, causing virtually 100% bounce rate.',
        recommendation:
          'Renew or replace your SSL certificate through a recognized Certificate Authority (CA) immediately.',
        priorityScore: 99,
      });
    } else if (sslCert.daysRemaining !== undefined && sslCert.daysRemaining <= 15) {
      score -= 15;
      issues.push({
        category: 'security',
        severity: 'high',
        issueCode: 'SEC_SSL_EXPIRING_SOON',
        title: `SSL Certificate Expiring in ${sslCert.daysRemaining} Days`,
        url,
        evidence: `Certificate issued by "${sslCert.issuer}" expires on ${sslCert.validTo} (${sslCert.daysRemaining} days remaining).`,
        whyItMatters:
          'If the certificate expires before renewal, browsers will immediately block all visitor traffic.',
        recommendation:
          'Trigger automatic renewal or contact your hosting provider to ensure certificate renewal before expiration.',
        priorityScore: 90,
      });
    } else {
      issues.push({
        category: 'security',
        severity: 'passed',
        issueCode: 'SEC_SSL_CERT_VALID',
        title: 'Valid SSL/TLS Certificate Configured',
        url,
        evidence: `Trusted SSL certificate from "${sslCert.issuer}" with ${sslCert.daysRemaining} days remaining.`,
        whyItMatters: 'Guarantees end-to-end encrypted communication for visitors.',
        recommendation: 'Ensure auto-renewal is enabled.',
        priorityScore: 0,
      });
    }
  }

  // 3. Strict-Transport-Security (HSTS)
  const hsts = h['strict-transport-security'];
  const hasHsts = Boolean(hsts);
  if (!hasHsts) {
    score -= 10;
    issues.push({
      category: 'security',
      severity: 'high',
      issueCode: 'SEC_MISSING_HSTS',
      title: 'Missing Strict-Transport-Security (HSTS) Header',
      url,
      evidence: 'No "Strict-Transport-Security" header detected in HTTP response.',
      whyItMatters:
        'HSTS ensures browsers only connect via HTTPS, preventing SSL-stripping attacks and downgrade vulnerabilities.',
      recommendation:
        'Add header: "Strict-Transport-Security: max-age=31536000; includeSubDomains; preload".',
      priorityScore: 82,
    });
  } else {
    issues.push({
      category: 'security',
      severity: 'passed',
      issueCode: 'SEC_HSTS_CONFIGURED',
      title: 'HSTS Header Present',
      url,
      evidence: `Found HSTS header: "${hsts}".`,
      whyItMatters: 'Protects visitors against downgrade attacks.',
      recommendation: 'Ensure max-age is set to at least 1 year (31536000 seconds).',
      priorityScore: 0,
    });
  }

  // 4. Content-Security-Policy (CSP)
  const csp = h['content-security-policy'];
  const hasCsp = Boolean(csp);
  if (!hasCsp) {
    score -= 10;
    issues.push({
      category: 'security',
      severity: 'medium',
      issueCode: 'SEC_MISSING_CSP',
      title: 'Missing Content-Security-Policy (CSP) Header',
      url,
      evidence: 'No "Content-Security-Policy" header detected.',
      whyItMatters:
        'CSP is a powerful layer of defense that mitigates Cross-Site Scripting (XSS) and data injection attacks by restricting resource origins.',
      recommendation:
        'Define a Content-Security-Policy header specifying trusted script, image, and style sources.',
      priorityScore: 72,
    });
  }

  // 5. X-Frame-Options (Clickjacking defense)
  const xFrame = h['x-frame-options'];
  const hasXFrame = Boolean(xFrame || (csp && csp.includes('frame-ancestors')));
  if (!hasXFrame) {
    score -= 8;
    issues.push({
      category: 'security',
      severity: 'medium',
      issueCode: 'SEC_MISSING_X_FRAME_OPTIONS',
      title: 'Missing Clickjacking Defense (X-Frame-Options / frame-ancestors)',
      url,
      evidence: 'Neither "X-Frame-Options" nor CSP "frame-ancestors" header was configured.',
      whyItMatters:
        'Without clickjacking defense, malicious third-party websites can embed your site in a transparent iframe to hijack user clicks and actions.',
      recommendation:
        'Add "X-Frame-Options: SAMEORIGIN" or "Content-Security-Policy: frame-ancestors \'self\'" to response headers.',
      priorityScore: 70,
    });
  }

  // 6. X-Content-Type-Options
  const xContent = h['x-content-type-options'];
  const hasXContentType = Boolean(xContent && xContent.toLowerCase().includes('nosniff'));
  if (!hasXContentType) {
    score -= 6;
    issues.push({
      category: 'security',
      severity: 'medium',
      issueCode: 'SEC_MISSING_X_CONTENT_TYPE_OPTIONS',
      title: 'Missing X-Content-Type-Options: nosniff Header',
      url,
      evidence: 'The "X-Content-Type-Options" header is absent or not set to "nosniff".',
      whyItMatters:
        'Prevents browsers from MIME-sniffing a response away from the declared content-type, which could allow user-uploaded files to execute as executable script code.',
      recommendation:
        'Add "X-Content-Type-Options: nosniff" to all web server responses.',
      priorityScore: 68,
    });
  }

  // 7. Referrer-Policy
  const referrerPolicy = h['referrer-policy'];
  const hasReferrerPolicy = Boolean(referrerPolicy);
  if (!hasReferrerPolicy) {
    score -= 4;
    issues.push({
      category: 'security',
      severity: 'low',
      issueCode: 'SEC_MISSING_REFERRER_POLICY',
      title: 'Missing Referrer-Policy Header',
      url,
      evidence: 'No "Referrer-Policy" header detected.',
      whyItMatters:
        'Controls how much referrer information (including query parameters or internal IDs) is sent when navigating to external links.',
      recommendation:
        'Set "Referrer-Policy: strict-origin-when-cross-origin".',
      priorityScore: 40,
    });
  }

  // 8. Permissions-Policy
  const permPolicy = h['permissions-policy'] || h['feature-policy'];
  const hasPermissionsPolicy = Boolean(permPolicy);
  if (!hasPermissionsPolicy) {
    score -= 3;
    issues.push({
      category: 'security',
      severity: 'low',
      issueCode: 'SEC_MISSING_PERMISSIONS_POLICY',
      title: 'Missing Permissions-Policy Header',
      url,
      evidence: 'No "Permissions-Policy" header detected.',
      whyItMatters:
        'Restricts browser features like camera, microphone, geolocation, and payment request APIs from unauthorized third-party scripts.',
      recommendation:
        'Configure "Permissions-Policy: camera=(), microphone=(), geolocation=()".',
      priorityScore: 30,
    });
  }

  // 9. Mixed Content Check (if HTTPS)
  let mixedContentFound = 0;
  const mixedContentExamples: string[] = [];
  if (isHttps) {
    const $ = cheerio.load(html);
    $('script[src^="http://"], link[href^="http://"], img[src^="http://"], iframe[src^="http://"]').each((_, el) => {
      mixedContentFound++;
      const src = $(el).attr('src') || $(el).attr('href') || '';
      if (src && mixedContentExamples.length < 5) {
        mixedContentExamples.push(src);
      }
    });

    if (mixedContentFound > 0) {
      score -= 20;
      issues.push({
        category: 'security',
        severity: 'critical',
        issueCode: 'SEC_MIXED_CONTENT',
        title: `${mixedContentFound} Mixed Content Asset${mixedContentFound > 1 ? 's' : ''} Detected`,
        url,
        evidence: `Found ${mixedContentFound} insecure HTTP resource(s) loaded on an HTTPS page. Examples: ${mixedContentExamples.join(', ')}.`,
        whyItMatters:
          'Modern browsers automatically block active mixed content (scripts, stylesheets), breaking functionality, and show security warnings for passive mixed content (images).',
        recommendation:
          'Update all asset references to use https:// or relative paths.',
        priorityScore: 96,
      });
    }
  }

  // 10. Cookie Flags Check
  let insecureCookieCount = 0;
  const setCookie = headers['set-cookie'];
  if (setCookie) {
    const cookieList = Array.isArray(setCookie) ? setCookie : [setCookie];
    for (const c of cookieList) {
      const lower = c.toLowerCase();
      if (!lower.includes('secure') || !lower.includes('httponly')) {
        insecureCookieCount++;
      }
    }

    if (insecureCookieCount > 0) {
      score -= 6;
      issues.push({
        category: 'security',
        severity: 'medium',
        issueCode: 'SEC_INSECURE_COOKIE_FLAGS',
        title: 'Cookies Missing Secure or HttpOnly Flags',
        url,
        evidence: `Found ${insecureCookieCount} Set-Cookie header(s) lacking "Secure" or "HttpOnly" attributes.`,
        whyItMatters:
          'Cookies without HttpOnly can be accessed via client-side JavaScript, facilitating session theft during XSS attacks. Cookies without Secure can be transmitted over plain HTTP.',
        recommendation:
          'Always set "Secure; HttpOnly; SameSite=Lax" flags on all session cookies.',
        priorityScore: 65,
      });
    }
  }

  return {
    score: Math.max(0, Math.min(100, Math.round(score))),
    issues,
    details: {
      isHttps,
      sslCert,
      hasHsts,
      hasCsp,
      hasXFrame,
      hasXContentType,
      hasReferrerPolicy,
      hasPermissionsPolicy,
      mixedContentFound,
      mixedContentExamples,
      insecureCookieCount,
    },
  };
}
