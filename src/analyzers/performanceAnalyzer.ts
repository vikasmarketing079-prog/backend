import * as cheerio from 'cheerio';
import { AnalyzerIssue } from './seoAnalyzer.js';

export interface PerformanceInput {
  url: string;
  html: string;
  headers: Record<string, string | string[] | undefined>;
  responseTimeMs: number;
  pageSizeBytes: number;
  browserMetrics?: {
    fcp?: number;
    lcp?: number;
    cls?: number;
    tbt?: number;
    speedIndex?: number;
    totalRequests?: number;
    transferSizeBytes?: number;
  };
}

export interface PerformanceAnalysisResult {
  score: number;
  issues: AnalyzerIssue[];
  metrics: {
    ttfbMs: number;
    fcpMs?: number;
    lcpMs?: number;
    cls?: number;
    tbtMs?: number;
    speedIndexMs?: number;
    pageSizeKb: number;
    requestCount: number;
    isCompressed: boolean;
    compressionType?: string;
    hasBrowserCaching: boolean;
    cacheControl?: string;
    renderBlockingScriptsCount: number;
    renderBlockingStylesCount: number;
    unoptimizedImagesCount: number;
  };
  dataSource: 'playwright_lab' | 'http_inspection' | 'pagespeed_api';
}

export function analyzePerformance(input: PerformanceInput): PerformanceAnalysisResult {
  const { url, html, headers, responseTimeMs, pageSizeBytes, browserMetrics } = input;
  const $ = cheerio.load(html);
  const issues: AnalyzerIssue[] = [];
  let score = 100;

  // Header normalization
  const normalizedHeaders: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    normalizedHeaders[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : (v || '');
  }

  // 1. Time to First Byte (TTFB) / Server Response Time
  if (responseTimeMs > 1000) {
    score -= 20;
    issues.push({
      category: 'performance',
      severity: 'high',
      issueCode: 'PERF_SLOW_SERVER_RESPONSE',
      title: 'Slow Server Response Time (TTFB)',
      url,
      evidence: `Initial server response time was ${responseTimeMs}ms (recommended: under 300ms, acceptable: under 600ms).`,
      whyItMatters:
        'A slow TTFB delays the browser from receiving any HTML markup, directly degrading FCP and overall user retention.',
      recommendation:
        'Optimize database queries, enable server-side caching (Redis, Varnish), or utilize a CDN like Cloudflare to serve cached pages.',
      priorityScore: 90,
    });
  } else if (responseTimeMs > 500) {
    score -= 8;
    issues.push({
      category: 'performance',
      severity: 'medium',
      issueCode: 'PERF_MODERATE_TTFB',
      title: 'Moderate Server Response Time',
      url,
      evidence: `Server response time was ${responseTimeMs}ms.`,
      whyItMatters: 'Page delivery could be accelerated to improve perceived load times.',
      recommendation: 'Enable edge caching and optimize backend processing routines.',
      priorityScore: 50,
    });
  } else {
    issues.push({
      category: 'performance',
      severity: 'passed',
      issueCode: 'PERF_FAST_TTFB',
      title: 'Fast Initial Server Response Time',
      url,
      evidence: `Server responded in ${responseTimeMs}ms.`,
      whyItMatters: 'Fast server delivery establishes a foundation for excellent Core Web Vitals.',
      recommendation: 'Maintain existing server infrastructure and CDN configurations.',
      priorityScore: 0,
    });
  }

  // 2. HTTP Compression Check (gzip, brotli, zstd)
  const contentEncoding = normalizedHeaders['content-encoding'] || '';
  const isCompressed = /gzip|br|deflate|zstd/i.test(contentEncoding);

  if (!isCompressed && pageSizeBytes > 1024) {
    score -= 15;
    issues.push({
      category: 'performance',
      severity: 'high',
      issueCode: 'PERF_NO_COMPRESSION',
      title: 'Text Compression Disabled (Gzip/Brotli)',
      url,
      evidence: `Response headers do not include "Content-Encoding: gzip/br". Uncompressed payload is ${(pageSizeBytes / 1024).toFixed(1)} KB.`,
      whyItMatters:
        'Modern compression algorithms like Brotli and Gzip compress text HTML, CSS, and JS by 60% to 80%, reducing network bandwidth and mobile load times.',
      recommendation:
        'Enable Gzip or Brotli compression on your web server (Nginx gzip on, Apache mod_deflate, or CDN auto-minification).',
      priorityScore: 85,
    });
  } else {
    issues.push({
      category: 'performance',
      severity: 'passed',
      issueCode: 'PERF_COMPRESSION_ENABLED',
      title: 'Text Compression Enabled',
      url,
      evidence: `Content encoding: ${contentEncoding || 'Transfer-encoding compressed'}.`,
      whyItMatters: 'Minimizes transferred bytes over the network.',
      recommendation: 'Continue using modern Brotli/Gzip compression algorithms.',
      priorityScore: 0,
    });
  }

  // 3. Browser Caching Headers
  const cacheControl = normalizedHeaders['cache-control'] || '';
  const hasBrowserCaching = Boolean(cacheControl && !cacheControl.includes('no-store') && !cacheControl.includes('no-cache'));

  if (!cacheControl) {
    score -= 10;
    issues.push({
      category: 'performance',
      severity: 'medium',
      issueCode: 'PERF_MISSING_CACHE_CONTROL',
      title: 'Missing Cache-Control Headers',
      url,
      evidence: 'No "Cache-Control" header was returned by the web server.',
      whyItMatters:
        'Without cache directives, browsers may re-download unchanged assets on every page visit, wasting bandwidth and slowing down repeated page loads.',
      recommendation:
        'Configure Cache-Control headers with appropriate max-age values (e.g. "public, max-age=31536000, immutable" for versioned assets).',
      priorityScore: 65,
    });
  }

  // 4. Render-Blocking Scripts in <head>
  let renderBlockingScripts = 0;
  $('head script').each((_, el) => {
    const src = $(el).attr('src');
    const hasAsync = $(el).attr('async') !== undefined;
    const hasDefer = $(el).attr('defer') !== undefined;
    const type = $(el).attr('type') || '';
    if (src && !hasAsync && !hasDefer && type !== 'module') {
      renderBlockingScripts++;
    }
  });

  if (renderBlockingScripts > 0) {
    score -= Math.min(15, renderBlockingScripts * 4);
    issues.push({
      category: 'performance',
      severity: renderBlockingScripts > 2 ? 'high' : 'medium',
      issueCode: 'PERF_RENDER_BLOCKING_SCRIPTS',
      title: `${renderBlockingScripts} Render-Blocking JavaScript File${renderBlockingScripts > 1 ? 's' : ''}`,
      url,
      evidence: `Found ${renderBlockingScripts} synchronous <script src="..."> tag(s) inside the <head> without "defer" or "async" attributes.`,
      whyItMatters:
        'When the browser encounters synchronous scripts in the HTML <head>, it halts HTML parsing until the script is fully downloaded and executed.',
      recommendation:
        'Add the "defer" attribute to head scripts that do not require immediate execution, or move non-critical scripts to the bottom of <body>.',
      priorityScore: 75,
    });
  }

  // 5. Total Page Size Check
  const pageSizeKb = Math.round(pageSizeBytes / 1024);
  if (pageSizeKb > 3500) {
    score -= 15;
    issues.push({
      category: 'performance',
      severity: 'high',
      issueCode: 'PERF_OVERSIZED_PAYLOAD',
      title: 'Excessive Total Page Payload Size',
      url,
      evidence: `Estimated page transfer weight is ${pageSizeKb} KB (${(pageSizeKb / 1024).toFixed(1)} MB), exceeding the 3MB threshold.`,
      whyItMatters:
        'Large page payloads severely degrade performance on mobile 4G/3G networks, consuming mobile user data and increasing bounce rates.',
      recommendation:
        'Compress high-resolution images, enable code splitting, remove unused JavaScript libraries, and lazy-load off-screen assets.',
      priorityScore: 80,
    });
  } else if (pageSizeKb > 2000) {
    score -= 8;
    issues.push({
      category: 'performance',
      severity: 'medium',
      issueCode: 'PERF_MODERATE_PAYLOAD',
      title: 'Large Page Weight',
      url,
      evidence: `Total page payload is ${pageSizeKb} KB.`,
      whyItMatters: 'Heavier pages take longer to process on constrained networks.',
      recommendation: 'Evaluate assets and optimize images using WebP or AVIF formats.',
      priorityScore: 50,
    });
  }

  // 6. Image Optimization Opportunities
  let unoptimizedImages = 0;
  $('img').each((_, el) => {
    const src = ($(el).attr('src') || '').toLowerCase();
    if (src.endsWith('.bmp') || src.endsWith('.tiff') || (src.endsWith('.png') && !src.includes('logo') && !src.includes('icon'))) {
      unoptimizedImages++;
    }
  });

  if (unoptimizedImages > 3) {
    score -= 8;
    issues.push({
      category: 'performance',
      severity: 'medium',
      issueCode: 'PERF_LEGACY_IMAGE_FORMATS',
      title: 'Modern Image Formats Not Fully Adopted',
      url,
      evidence: `Found ${unoptimizedImages} raster image(s) using legacy PNG/BMP formats instead of modern WebP or AVIF formats.`,
      whyItMatters:
        'WebP and AVIF provide superior lossless and lossy compression compared to legacy PNG and JPEG formats, cutting image payload by 30-50%.',
      recommendation:
        'Convert photographic and complex images to WebP or AVIF format using sharp or an image CDN.',
      priorityScore: 60,
    });
  }

  // 7. Core Web Vitals (if Playwright lab data available)
  let fcpMs: number | undefined;
  let lcpMs: number | undefined;
  let cls: number | undefined;
  let tbtMs: number | undefined;
  let speedIndexMs: number | undefined;
  let requestCount = browserMetrics?.totalRequests || $('script, link[rel="stylesheet"], img').length;

  if (browserMetrics) {
    fcpMs = browserMetrics.fcp;
    lcpMs = browserMetrics.lcp;
    cls = browserMetrics.cls;
    tbtMs = browserMetrics.tbt;
    speedIndexMs = browserMetrics.speedIndex;

    // LCP evaluation
    if (lcpMs !== undefined) {
      if (lcpMs > 4000) {
        score -= 20;
        issues.push({
          category: 'performance',
          severity: 'critical',
          issueCode: 'PERF_POOR_LCP',
          title: 'Poor Largest Contentful Paint (LCP)',
          url,
          evidence: `Lab LCP measured at ${(lcpMs / 1000).toFixed(2)}s (Google good threshold: < 2.5s; poor: > 4.0s).`,
          whyItMatters:
            'LCP measures perceived load speed by marking the point when the main content of the page has likely loaded.',
          recommendation:
            'Preload critical hero images with <link rel="preload">, eliminate render-blocking resources, and optimize server response time.',
          priorityScore: 95,
        });
      } else if (lcpMs > 2500) {
        score -= 10;
        issues.push({
          category: 'performance',
          severity: 'medium',
          issueCode: 'PERF_NEEDS_IMPROVEMENT_LCP',
          title: 'LCP Needs Improvement',
          url,
          evidence: `Lab LCP is ${(lcpMs / 1000).toFixed(2)}s.`,
          whyItMatters: 'Page main content takes longer than 2.5 seconds to render.',
          recommendation: 'Prioritize loading the largest hero image or text element.',
          priorityScore: 65,
        });
      } else {
        issues.push({
          category: 'performance',
          severity: 'passed',
          issueCode: 'PERF_GOOD_LCP',
          title: 'Good Largest Contentful Paint (LCP)',
          url,
          evidence: `Lab LCP measured at ${(lcpMs / 1000).toFixed(2)}s (under 2.5s threshold).`,
          whyItMatters: 'Users see the main page content quickly.',
          recommendation: 'Keep hero assets lightweight.',
          priorityScore: 0,
        });
      }
    }

    // CLS evaluation
    if (cls !== undefined) {
      if (cls > 0.25) {
        score -= 15;
        issues.push({
          category: 'performance',
          severity: 'high',
          issueCode: 'PERF_POOR_CLS',
          title: 'High Cumulative Layout Shift (CLS)',
          url,
          evidence: `Cumulative Layout Shift is ${cls.toFixed(3)} (good threshold: < 0.1, poor: > 0.25).`,
          whyItMatters:
            'High layout shifts cause buttons and text to move abruptly while users read or attempt to tap, creating poor user experiences.',
          recommendation:
            'Always specify explicit width and height attributes on all <img>, <video>, and iframe elements, and avoid dynamically injecting content above existing elements.',
          priorityScore: 85,
        });
      } else if (cls <= 0.1) {
        issues.push({
          category: 'performance',
          severity: 'passed',
          issueCode: 'PERF_GOOD_CLS',
          title: 'Stable Layout (Low CLS)',
          url,
          evidence: `Cumulative Layout Shift is ${cls.toFixed(3)}.`,
          whyItMatters: 'Elements remain visually stable as the page loads.',
          recommendation: 'Continue defining aspect ratios for media assets.',
          priorityScore: 0,
        });
      }
    }
  }

  return {
    score: Math.max(0, Math.min(100, Math.round(score))),
    issues,
    metrics: {
      ttfbMs: responseTimeMs,
      fcpMs,
      lcpMs,
      cls,
      tbtMs,
      speedIndexMs,
      pageSizeKb,
      requestCount,
      isCompressed,
      compressionType: contentEncoding || undefined,
      hasBrowserCaching,
      cacheControl: cacheControl || undefined,
      renderBlockingScriptsCount: renderBlockingScripts,
      renderBlockingStylesCount: $('head link[rel="stylesheet"]').length,
      unoptimizedImagesCount: unoptimizedImages,
    },
    dataSource: browserMetrics ? 'playwright_lab' : 'http_inspection',
  };
}

