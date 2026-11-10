import axios from 'axios';
import * as cheerio from 'cheerio';
import robotsParser from 'robots-parser';
import { URL } from 'url';
import { validateUrlForSSRF } from '../crawler/ssrfValidator.js';
import { AnalyzerIssue } from './seoAnalyzer.js';

export interface RobotsTxtCheckResult {
  hasRobotsTxt: boolean;
  isAllowed: boolean;
  sitemapsFound: string[];
  rawRobots?: string;
}

export interface SitemapCheckResult {
  hasSitemap: boolean;
  sitemapUrl?: string;
  urlsCount?: number;
  error?: string;
}

export interface TechnicalAnalysisResult {
  score: number;
  issues: AnalyzerIssue[];
  details: {
    statusCode: number;
    hasFavicon: boolean;
    faviconUrl?: string;
    isUrlClean: boolean;
    robotsTxt: RobotsTxtCheckResult;
    sitemap: SitemapCheckResult;
  };
}

/**
 * Checks robots.txt availability and checks if specific URL is allowed for bots
 */
export async function checkRobotsTxt(originUrl: string, targetPath: string): Promise<RobotsTxtCheckResult> {
  try {
    const origin = new URL(originUrl).origin;
    const robotsUrl = `${origin}/robots.txt`;

    const ssrf = await validateUrlForSSRF(robotsUrl);
    if (!ssrf.isValid) {
      return { hasRobotsTxt: false, isAllowed: true, sitemapsFound: [] };
    }

    const res = await axios.get(robotsUrl, {
      timeout: 5000,
      headers: { 'User-Agent': 'SiteAuditProBot/1.0' },
      validateStatus: (s) => s < 500,
    });

    if (res.status === 200 && typeof res.data === 'string') {
      const robots = robotsParser(robotsUrl, res.data);
      const isAllowed = robots.isAllowed(targetPath, 'Googlebot') ?? true;
      const sitemaps = robots.getSitemaps();

      return {
        hasRobotsTxt: true,
        isAllowed,
        sitemapsFound: sitemaps || [],
        rawRobots: res.data.slice(0, 500),
      };
    }
  } catch {
    // robots.txt unreachable
  }

  return { hasRobotsTxt: false, isAllowed: true, sitemapsFound: [] };
}

/**
 * Checks sitemap.xml presence on domain
 */
export async function checkSitemap(originUrl: string, knownSitemapUrl?: string): Promise<SitemapCheckResult> {
  try {
    const origin = new URL(originUrl).origin;
    const sitemapTarget = knownSitemapUrl || `${origin}/sitemap.xml`;

    const ssrf = await validateUrlForSSRF(sitemapTarget);
    if (!ssrf.isValid) {
      return { hasSitemap: false, error: 'SSRF validation blocked' };
    }

    const res = await axios.get(sitemapTarget, {
      timeout: 6000,
      headers: { 'User-Agent': 'SiteAuditProBot/1.0' },
      validateStatus: (s) => s < 500,
    });

    if (res.status === 200 && typeof res.data === 'string' && res.data.includes('<urlset') || res.data.includes('<sitemapindex')) {
      const matches = res.data.match(/<loc>/g);
      return {
        hasSitemap: true,
        sitemapUrl: sitemapTarget,
        urlsCount: matches ? matches.length : 1,
      };
    }
  } catch (err: any) {
    return { hasSitemap: false, error: err.message };
  }

  return { hasSitemap: false };
}

/**
 * Analyzes technical infrastructure of the audited page and origin
 */
export async function analyzeTechnical(
  url: string,
  html: string,
  statusCode: number,
  robotsTxtResult?: RobotsTxtCheckResult,
  sitemapResult?: SitemapCheckResult
): Promise<TechnicalAnalysisResult> {
  const $ = cheerio.load(html);
  const issues: AnalyzerIssue[] = [];
  let score = 100;
  const parsedUrl = new URL(url);

  // 1. HTTP Status Code check
  if (statusCode >= 400 && statusCode < 500) {
    score -= 40;
    issues.push({
      category: 'technical',
      severity: 'critical',
      issueCode: 'TECH_HTTP_4XX_ERROR',
      title: `Client Error Response: HTTP ${statusCode}`,
      url,
      evidence: `Server responded with HTTP status code ${statusCode}.`,
      whyItMatters:
        'Client error codes prevent users and search engine crawlers from reading any page content.',
      recommendation:
        'Verify URL routing, server configuration, or implement a 301 permanent redirect if this resource moved.',
      priorityScore: 99,
    });
  } else if (statusCode >= 500) {
    score -= 50;
    issues.push({
      category: 'technical',
      severity: 'critical',
      issueCode: 'TECH_HTTP_5XX_ERROR',
      title: `Internal Server Error: HTTP ${statusCode}`,
      url,
      evidence: `Server returned internal server failure code ${statusCode}.`,
      whyItMatters:
        'Server errors take websites offline for users and quickly de-index pages from Google search rankings.',
      recommendation:
        'Investigate backend application server logs and database error traces immediately.',
      priorityScore: 100,
    });
  } else {
    issues.push({
      category: 'technical',
      severity: 'passed',
      issueCode: 'TECH_HTTP_200_OK',
      title: 'Valid HTTP 200 OK Status Code',
      url,
      evidence: `Page returned standard HTTP status ${statusCode}.`,
      whyItMatters: 'Page delivers successfully to clients and crawlers.',
      recommendation: 'Maintain server uptime monitoring.',
      priorityScore: 0,
    });
  }

  // 2. Favicon Check
  const faviconLink = $('link[rel*="icon" i]').attr('href');
  const hasFavicon = Boolean(faviconLink);

  if (!hasFavicon) {
    score -= 10;
    issues.push({
      category: 'technical',
      severity: 'low',
      issueCode: 'TECH_MISSING_FAVICON',
      title: 'Missing Favicon Declaration',
      url,
      evidence: 'No <link rel="icon"> or shortcut icon found in document head.',
      whyItMatters:
        'Favicons display beside your site in browser tabs, bookmarks, and mobile Google search results. Missing icons make results look unfinished and decrease search CTR.',
      recommendation:
        'Add a high-resolution favicon in .ico or .png format: <link rel="icon" href="/favicon.ico" sizes="any">.',
      priorityScore: 45,
    });
  } else {
    issues.push({
      category: 'technical',
      severity: 'passed',
      issueCode: 'TECH_FAVICON_FOUND',
      title: 'Favicon Present',
      url,
      evidence: `Favicon defined at: "${faviconLink}".`,
      whyItMatters: 'Enhances brand recognition in tabs and search listings.',
      recommendation: 'Ensure favicon includes SVG or multiple size variants.',
      priorityScore: 0,
    });
  }

  // 3. URL Cleanliness
  const hasSuspiciousParams = parsedUrl.search.length > 100;
  const hasUppercaseInPath = /[A-Z]/.test(parsedUrl.pathname);
  const isUrlClean = !hasSuspiciousParams && !hasUppercaseInPath;

  if (hasUppercaseInPath) {
    score -= 5;
    issues.push({
      category: 'technical',
      severity: 'low',
      issueCode: 'TECH_UPPERCASE_URL',
      title: 'Uppercase Characters Detected in URL Path',
      url,
      evidence: `URL path contains uppercase letters: "${parsedUrl.pathname}".`,
      whyItMatters:
        'URLs are case-sensitive on Linux/Unix web servers. Mixed case URLs can cause accidental 404 errors and duplicate content if both versions resolve.',
      recommendation:
        'Standardize all URL paths to lowercase and enforce lowercase 301 redirects.',
      priorityScore: 35,
    });
  }

  // 4. Robots.txt check
  const robots = robotsTxtResult || (await checkRobotsTxt(url, parsedUrl.pathname));
  if (!robots.hasRobotsTxt) {
    score -= 10;
    issues.push({
      category: 'technical',
      severity: 'medium',
      issueCode: 'TECH_MISSING_ROBOTS_TXT',
      title: 'Missing robots.txt File',
      url,
      evidence: `Could not retrieve robots.txt from "${parsedUrl.origin}/robots.txt".`,
      whyItMatters:
        'Robots.txt provides crawling directives to search engine bots, preventing crawler overload and keeping private staging directories out of search indices.',
      recommendation:
        'Create a robots.txt file at your website root with directives and sitemap reference.',
      priorityScore: 65,
    });
  } else if (!robots.isAllowed) {
    score -= 20;
    issues.push({
      category: 'technical',
      severity: 'high',
      issueCode: 'TECH_DISALLOWED_BY_ROBOTS',
      title: 'Page Disallowed by robots.txt',
      url,
      evidence: 'Robots.txt explicitly disallows search engine crawlers from accessing this URL path.',
      whyItMatters:
        'Googlebot and other search engines will avoid crawling this page, preventing it from being properly indexed and ranked.',
      recommendation:
        'If this page should be publicly discoverable, adjust Disallow rules in your robots.txt.',
      priorityScore: 88,
    });
  } else {
    issues.push({
      category: 'technical',
      severity: 'passed',
      issueCode: 'TECH_ROBOTS_TXT_VALID',
      title: 'Robots.txt Present and Accessible',
      url,
      evidence: `Robots.txt file found and allows crawler access to this page.`,
      whyItMatters: 'Ensures structured crawler management.',
      recommendation: 'Audit crawl directives periodically.',
      priorityScore: 0,
    });
  }

  // 5. XML Sitemap check
  const sitemap = sitemapResult || (await checkSitemap(url, robots.sitemapsFound[0]));
  if (!sitemap.hasSitemap) {
    score -= 10;
    issues.push({
      category: 'technical',
      severity: 'medium',
      issueCode: 'TECH_MISSING_XML_SITEMAP',
      title: 'Missing XML Sitemap',
      url,
      evidence: `No valid XML sitemap was located at /sitemap.xml or declared inside robots.txt.`,
      whyItMatters:
        'An XML sitemap helps search engines discover all canonical URLs on your site, especially new, deep, or updated pages.',
      recommendation:
        'Generate an XML sitemap and submit it to Google Search Console and Bing Webmaster Tools.',
      priorityScore: 65,
    });
  } else {
    issues.push({
      category: 'technical',
      severity: 'passed',
      issueCode: 'TECH_XML_SITEMAP_FOUND',
      title: 'XML Sitemap Available',
      url,
      evidence: `Found valid XML sitemap at: "${sitemap.sitemapUrl}" with approximately ${sitemap.urlsCount || 'multiple'} URLs.`,
      whyItMatters: 'Accelerates search engine page discovery.',
      recommendation: 'Ensure sitemap automatically updates whenever new content is published.',
      priorityScore: 0,
    });
  }

  return {
    score: Math.max(0, Math.min(100, Math.round(score))),
    issues,
    details: {
      statusCode,
      hasFavicon,
      faviconUrl: faviconLink,
      isUrlClean,
      robotsTxt: robots,
      sitemap,
    },
  };
}

