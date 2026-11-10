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
}
