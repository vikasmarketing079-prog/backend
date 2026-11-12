import { Request, Response } from 'express';
import axios from 'axios';
import { validateUrlForSSRF } from '../crawler/ssrfValidator.js';
import { normalizeUrl } from '../crawler/urlNormalizer.js';
import { analyzeSeo } from '../analyzers/seoAnalyzer.js';
import { analyzePerformance } from '../analyzers/performanceAnalyzer.js';
import { analyzeMobileFromHtml } from '../analyzers/mobileAnalyzer.js';
import { inspectSslCertificate, analyzeSecurity } from '../analyzers/securityAnalyzer.js';
import { analyzeBrokenLinks } from '../analyzers/brokenLinksAnalyzer.js';
import { URL } from 'url';

export class PublicToolsController {
  /**
   * Helper to validate and fetch a single target page safely
   */
  private static async fetchTargetPage(rawUrl: string): Promise<{
    url: string;
    html: string;
    headers: Record<string, any>;
    status: number;
    responseTimeMs: number;
  }> {
    const ssrf = await validateUrlForSSRF(rawUrl);
    if (!ssrf.isValid) {
      throw new Error(`Security validation failed: ${ssrf.reason}`);
    }

    const normalized = normalizeUrl(rawUrl);
    if (!normalized) {
      throw new Error('Invalid URL format');
    }

    const startTime = Date.now();
    const res = await axios.get(normalized, {
      timeout: 9000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) SiteAuditProPublicTool/1.0',
        Accept: 'text/html,*/*',
      },
      validateStatus: () => true,
    });

    return {
      url: normalized,
      html: typeof res.data === 'string' ? res.data : String(res.data || ''),
      headers: res.headers,
      status: res.status,
      responseTimeMs: Date.now() - startTime,
    };
  }

  /**
   * Free SEO Checker tool
   */
  public static async checkSeo(req: Request, res: Response): Promise<void> {
    try {
      const { url } = req.body;
      if (!url) {
        res.status(400).json({ success: false, error: 'URL is required' });
        return;
      }

      const page = await PublicToolsController.fetchTargetPage(url);
      const result = analyzeSeo(page.url, page.html, page.status);

      res.json({
        success: true,
        tool: 'seo-checker',
        targetUrl: page.url,
        data: result,
      });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  }

  /**
   * Website Speed Checker tool
   */
  public static async checkSpeed(req: Request, res: Response): Promise<void> {
    try {
      const { url } = req.body;
      if (!url) {
        res.status(400).json({ success: false, error: 'URL is required' });
        return;
      }

      const page = await PublicToolsController.fetchTargetPage(url);
      const result = analyzePerformance({
        url: page.url,
        html: page.html,
        headers: page.headers,
        responseTimeMs: page.responseTimeMs,
        pageSizeBytes: Buffer.byteLength(page.html, 'utf-8'),
      });

      res.json({
        success: true,
        tool: 'speed-checker',
        targetUrl: page.url,
        data: result,
      });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  }

  /**
   * Broken Link Checker tool
   */
  public static async checkBrokenLinks(req: Request, res: Response): Promise<void> {
    try {
      const { url } = req.body;
      if (!url) {
        res.status(400).json({ success: false, error: 'URL is required' });
        return;
      }

      const page = await PublicToolsController.fetchTargetPage(url);
      const result = await analyzeBrokenLinks(page.url, page.html, page.url, 15);

      res.json({
        success: true,
        tool: 'broken-link-checker',
        targetUrl: page.url,
        data: result,
      });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  }

  /**
   * SSL Certificate Checker tool
   */
  public static async checkSsl(req: Request, res: Response): Promise<void> {
    try {
      const { url } = req.body;
      if (!url) {
        res.status(400).json({ success: false, error: 'URL or domain is required' });
        return;
      }

      let formatted = url.trim();
      if (!formatted.startsWith('http://') && !formatted.startsWith('https://')) {
        formatted = 'https://' + formatted;
      }

      const parsed = new URL(formatted);
      const certInfo = await inspectSslCertificate(parsed.hostname);

      res.json({
        success: true,
        tool: 'ssl-checker',
        hostname: parsed.hostname,
        data: certInfo,
      });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  }

  /**
   * Mobile-Friendly Checker tool
   */
  public static async checkMobile(req: Request, res: Response): Promise<void> {
    try {
      const { url } = req.body;
      if (!url) {
        res.status(400).json({ success: false, error: 'URL is required' });
        return;
      }

      const page = await PublicToolsController.fetchTargetPage(url);
      const result = analyzeMobileFromHtml(page.url, page.html);

      res.json({
        success: true,
        tool: 'mobile-friendly-checker',
        targetUrl: page.url,
        data: result,
      });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  }

  /**
   * Security Header Checker tool
   */
  public static async checkSecurityHeaders(req: Request, res: Response): Promise<void> {
    try {
      const { url } = req.body;
      if (!url) {
        res.status(400).json({ success: false, error: 'URL is required' });
        return;
      }

      const page = await PublicToolsController.fetchTargetPage(url);
      const result = await analyzeSecurity(page.url, page.html, page.headers);

      res.json({
        success: true,
        tool: 'security-header-checker',
        targetUrl: page.url,
        data: result,
      });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  }

  /**
   * Competitor Head-to-Head Live Battle Scanner
   * Compares 2 websites simultaneously across Speed, SEO, Mobile, and Security
   */
  public static async runCompetitorBattle(req: Request, res: Response): Promise<void> {
    try {
      const { urlA, urlB } = req.body;
      if (!urlA || !urlB) {
        res.status(400).json({ success: false, error: 'Both urlA and urlB are required' });
        return;
      }

      // Fetch both pages in parallel safely
      const [pageA, pageB] = await Promise.all([
        PublicToolsController.fetchTargetPage(urlA),
        PublicToolsController.fetchTargetPage(urlB),
      ]);

      // Run analyzers on both pages in parallel
      const [seoA, seoB, perfA, perfB, secA, secB, mobA, mobB] = await Promise.all([
        analyzeSeo(pageA.url, pageA.html, pageA.status),
        analyzeSeo(pageB.url, pageB.html, pageB.status),
        analyzePerformance({
          url: pageA.url,
          html: pageA.html,
          headers: pageA.headers,
          responseTimeMs: pageA.responseTimeMs,
          pageSizeBytes: Buffer.byteLength(pageA.html, 'utf8'),
        }),
        analyzePerformance({
          url: pageB.url,
          html: pageB.html,
          headers: pageB.headers,
          responseTimeMs: pageB.responseTimeMs,
          pageSizeBytes: Buffer.byteLength(pageB.html, 'utf8'),
        }),
        analyzeSecurity(pageA.url, pageA.html, pageA.headers),
        analyzeSecurity(pageB.url, pageB.html, pageB.headers),
        analyzeMobileFromHtml(pageA.url, pageA.html),
        analyzeMobileFromHtml(pageB.url, pageB.html),
      ]);

      // Calculate composite score (0-100)
      const scoreA = Math.round(
        seoA.score * 0.35 + perfA.score * 0.3 + secA.score * 0.2 + mobA.score * 0.15
      );
      const scoreB = Math.round(
        seoB.score * 0.35 + perfB.score * 0.3 + secB.score * 0.2 + mobB.score * 0.15
      );

      // Determine round winners
      const speedWinner =
        pageA.responseTimeMs < pageB.responseTimeMs ? 'A' : pageA.responseTimeMs > pageB.responseTimeMs ? 'B' : 'TIE';
      const seoWinner = seoA.score > seoB.score ? 'A' : seoA.score < seoB.score ? 'B' : 'TIE';
      const secWinner = secA.score > secB.score ? 'A' : secA.score < secB.score ? 'B' : 'TIE';
      const mobWinner = mobA.score > mobB.score ? 'A' : mobA.score < mobB.score ? 'B' : 'TIE';
      const overallWinner = scoreA > scoreB ? 'A' : scoreA < scoreB ? 'B' : 'TIE';

      // Actionable outrank tips
      const outrankTips: string[] = [];
      if (pageA.responseTimeMs > pageB.responseTimeMs) {
        outrankTips.push(
          `Your server response is ${pageA.responseTimeMs - pageB.responseTimeMs}ms slower than your competitor. Implement server caching or a CDN to beat their speed.`
        );
      } else {
        outrankTips.push(
          `You load ${pageB.responseTimeMs - pageA.responseTimeMs}ms faster than your competitor! Highlight your snappy page experience.`
        );
      }

      if (!seoA.details.metaDescription && seoB.details.metaDescription) {
        outrankTips.push(
          `Competitor has an optimized meta description while yours is missing. Adding one will steal search clicks.`
        );
      }
      if (seoA.details.titleLength < 40 && seoB.details.titleLength >= 45) {
        outrankTips.push(
          `Expand your page title to 50-60 characters with primary commercial keywords.`
        );
      }
      if (secA.score < secB.score) {
        outrankTips.push(
          `Competitor uses tighter security defense headers (HSTS, CSP). Adding them builds stronger trust with Google.`
        );
      }
      if (outrankTips.length < 3) {
        outrankTips.push(
          `Add schema.org structured data (Organization, FAQ) to earn Google Rich Snippets ahead of your competitor.`
        );
      }

      res.json({
        success: true,
        data: {
          siteA: {
            url: pageA.url,
            score: scoreA,
            responseTimeMs: pageA.responseTimeMs,
            pageSizeKb: (Buffer.byteLength(pageA.html, 'utf8') / 1024).toFixed(1),
            title: seoA.details.title,
            titleLength: seoA.details.titleLength,
            metaDescription: seoA.details.metaDescription,
            descLength: seoA.details.descriptionLength,
            h1Count: seoA.details.h1s.length,
            h1Text: seoA.details.h1s[0] || null,
            imagesCount: seoA.details.totalImages,
            missingAltCount: seoA.details.missingAltCount,
            scores: {
              seo: seoA.score,
              performance: perfA.score,
              security: secA.score,
              mobile: mobA.score,
            },
            isHttps: pageA.url.startsWith('https://'),
          },
          siteB: {
            url: pageB.url,
            score: scoreB,
            responseTimeMs: pageB.responseTimeMs,
            pageSizeKb: (Buffer.byteLength(pageB.html, 'utf8') / 1024).toFixed(1),
            title: seoB.details.title,
            titleLength: seoB.details.titleLength,
            metaDescription: seoB.details.metaDescription,
            descLength: seoB.details.descriptionLength,
            h1Count: seoB.details.h1s.length,
            h1Text: seoB.details.h1s[0] || null,
            imagesCount: seoB.details.totalImages,
            missingAltCount: seoB.details.missingAltCount,
            scores: {
              seo: seoB.score,
              performance: perfB.score,
              security: secB.score,
              mobile: mobB.score,
            },
            isHttps: pageB.url.startsWith('https://'),
          },
          winners: {
            overall: overallWinner,
            speed: speedWinner,
            seo: seoWinner,
            security: secWinner,
            mobile: mobWinner,
          },
          outrankTips,
        },
      });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message || 'Battle analysis failed' });
    }
  }
}

