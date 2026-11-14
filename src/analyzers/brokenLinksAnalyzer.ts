import axios from 'axios';
import * as cheerio from 'cheerio';
import { normalizeUrl, isSameOriginOrDomain } from '../crawler/urlNormalizer.js';
import { validateUrlForSSRF } from '../crawler/ssrfValidator.js';
import { AnalyzerIssue } from './seoAnalyzer.js';

export interface LinkCheckItem {
  sourceUrl: string;
  targetUrl: string;
  type: 'internal_link' | 'external_link' | 'image';
  statusCode?: number;
  statusText?: string;
  isBroken: boolean;
  errorType?: 'not_found' | 'server_error' | 'timeout' | 'invalid_url' | 'network_error';
  isRedirect?: boolean;
  redirectTarget?: string;
}

export interface BrokenLinksResult {
  score: number;
  issues: AnalyzerIssue[];
  totalLinksChecked: number;
  brokenLinks: LinkCheckItem[];
  redirectedLinks: LinkCheckItem[];
}

/**
 * Checks a specific link destination safely with timeout and SSRF check
 */
export async function testDestinationUrl(url: string): Promise<{
  statusCode?: number;
  statusText?: string;
  isBroken: boolean;
  errorType?: 'not_found' | 'server_error' | 'timeout' | 'invalid_url' | 'network_error';
  isRedirect?: boolean;
  redirectTarget?: string;
}> {
  // First, SSRF check on destination
  const ssrf = await validateUrlForSSRF(url);
  if (!ssrf.isValid) {
    return {
      isBroken: true,
      errorType: 'invalid_url',
      statusText: 'Disallowed destination address',
    };
  }

  try {
    const res = await axios.get(url, {
      timeout: 6000,
      maxRedirects: 3,
      maxContentLength: 250000, // Limit link check payload download to 250KB to preserve memory
      maxBodyLength: 250000,
      headers: {
        'User-Agent': 'SiteAuditProBot/1.0 (+https://siteauditpro.com/bot)',
        Accept: '*/*',
      },
      validateStatus: () => true, // capture all status codes
    });

    const is4xx = res.status >= 400 && res.status < 500;
    const is5xx = res.status >= 500;

    return {
      statusCode: res.status,
      statusText: res.statusText,
      isBroken: is4xx || is5xx,
      errorType: is4xx ? 'not_found' : is5xx ? 'server_error' : undefined,
    };
  } catch (err: any) {
    if (err.message?.includes('maxContentLength') || err.message?.includes('maxBodyLength')) {
      return {
        statusCode: 200,
        statusText: 'OK',
        isBroken: false,
      };
    }
    const code = err.code || '';
    if (code === 'ECONNABORTED' || err.message?.includes('timeout')) {
      return {
        isBroken: false, // Don't treat network timeout as confirmed 404
        errorType: 'timeout',
        statusText: 'Request timed out after 6 seconds',
      };
    }
    return {
      isBroken: true,
      errorType: 'network_error',
      statusText: err.message || 'Network resolution failure',
    };
  }
}

/**
 * Analyzes links and images in the HTML document
 */
export async function analyzeBrokenLinks(
  sourceUrl: string,
  html: string,
  originDomain: string,
  sampleLimit = 15 // Check up to 15 unique links per page to keep audits responsive
): Promise<BrokenLinksResult> {
  const $ = cheerio.load(html);
  const issues: AnalyzerIssue[] = [];
  const brokenLinks: LinkCheckItem[] = [];
  const redirectedLinks: LinkCheckItem[] = [];
  let score = 100;

  const linksToTest: Array<{ targetUrl: string; type: 'internal_link' | 'external_link' | 'image' }> = [];
  const seenUrls = new Set<string>();

  // Extract hyperlinks
  $('a[href]').each((_, el) => {
    const rawHref = $(el).attr('href')?.trim();
    if (!rawHref || rawHref.startsWith('#') || rawHref.startsWith('javascript:') || rawHref.startsWith('mailto:') || rawHref.startsWith('tel:')) {
      return;
    }
    const resolved = normalizeUrl(rawHref, sourceUrl);
    if (resolved && !seenUrls.has(resolved)) {
      seenUrls.add(resolved);
      const isInternal = isSameOriginOrDomain(resolved, originDomain);
      linksToTest.push({
        targetUrl: resolved,
        type: isInternal ? 'internal_link' : 'external_link',
      });
    }
  });

  // Extract images
  $('img[src]').each((_, el) => {
    const rawSrc = $(el).attr('src')?.trim();
    if (!rawSrc || rawSrc.startsWith('data:')) return;
    const resolved = normalizeUrl(rawSrc, sourceUrl);
    if (resolved && !seenUrls.has(resolved)) {
      seenUrls.add(resolved);
      linksToTest.push({
        targetUrl: resolved,
        type: 'image',
      });
    }
  });

  // Test prioritized sample
  const sample = linksToTest.slice(0, sampleLimit);

  await Promise.all(
    sample.map(async (item) => {
      const result = await testDestinationUrl(item.targetUrl);
      const linkItem: LinkCheckItem = {
        sourceUrl,
        targetUrl: item.targetUrl,
        type: item.type,
        statusCode: result.statusCode,
        statusText: result.statusText,
        isBroken: result.isBroken,
        errorType: result.errorType,
        isRedirect: result.isRedirect,
      };

      if (result.isBroken) {
        brokenLinks.push(linkItem);

        if (item.type === 'internal_link') {
          score -= 15;
          issues.push({
            category: 'broken_link',
            severity: 'critical',
            issueCode: 'LINK_INTERNAL_BROKEN',
            title: `Broken Internal Link (${result.statusCode || result.errorType})`,
            url: sourceUrl,
            evidence: `Found broken internal link to "${item.targetUrl}" returning HTTP status ${result.statusCode || result.statusText || 'Error'}.`,
            whyItMatters:
              'Internal broken links trap users on dead ends, bleed crawl budget, waste PageRank equity, and directly increase visitor drop-off rates.',
            recommendation:
              `Update or remove the link to "${item.targetUrl}" on page ${sourceUrl}.`,
            priorityScore: 94,
          });
        } else if (item.type === 'image') {
          score -= 10;
          issues.push({
            category: 'broken_link',
            severity: 'high',
            issueCode: 'LINK_BROKEN_IMAGE',
            title: 'Broken Image Asset',
            url: sourceUrl,
            evidence: `Image resource failed to load: "${item.targetUrl}" (HTTP ${result.statusCode || result.statusText}).`,
            whyItMatters:
              'Broken images create an unprofessional appearance and signal poor site maintenance to visitors.',
            recommendation:
              'Restore the missing image file or update the <img> src attribute.',
            priorityScore: 82,
          });
        } else {
          score -= 5;
          issues.push({
            category: 'broken_link',
            severity: 'medium',
            issueCode: 'LINK_EXTERNAL_BROKEN',
            title: `Broken Outbound External Link`,
            url: sourceUrl,
            evidence: `Outbound link to "${item.targetUrl}" failed with HTTP ${result.statusCode || result.statusText}.`,
            whyItMatters:
              'Linking to broken external resources degrades user trust and search engine perception of content freshness.',
            recommendation:
              'Replace the dead external link with an active resource or remove it.',
            priorityScore: 60,
          });
        }
      }
    })
  );

  if (brokenLinks.length === 0 && sample.length > 0) {
    issues.push({
      category: 'broken_link',
      severity: 'passed',
      issueCode: 'LINK_ALL_SAMPLES_HEALTHY',
      title: 'All Sampled Links & Images Verified Functional',
      url: sourceUrl,
      evidence: `Tested ${sample.length} internal and external links without any HTTP 404 or connection failures.`,
      whyItMatters: 'Smooth navigation flow for visitors and web crawlers.',
      recommendation: 'Periodically monitor links during content publishing.',
      priorityScore: 0,
    });
  }

  return {
    score: Math.max(0, Math.min(100, Math.round(score))),
    issues,
    totalLinksChecked: sample.length,
    brokenLinks,
    redirectedLinks,
  };
}

