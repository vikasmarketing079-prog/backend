import mongoose from 'mongoose';
import { Audit, IAudit } from '../models/Audit.js';
import { PageAudit, IPageAudit } from '../models/PageAudit.js';
import { AuditIssue, IAuditIssue } from '../models/AuditIssue.js';
import { Website } from '../models/Website.js';
import { User } from '../models/User.js';
import { CrawlerEngine } from '../crawler/crawlerEngine.js';
import { validateUrlForSSRF } from '../crawler/ssrfValidator.js';
import { normalizeUrl } from '../crawler/urlNormalizer.js';
import { analyzeSeo } from '../analyzers/seoAnalyzer.js';
import { analyzePerformance } from '../analyzers/performanceAnalyzer.js';
import { analyzeMobileFromHtml } from '../analyzers/mobileAnalyzer.js';
import { analyzeSecurity, inspectSslCertificate } from '../analyzers/securityAnalyzer.js';
import { analyzeBrokenLinks } from '../analyzers/brokenLinksAnalyzer.js';
import { analyzeContent } from '../analyzers/contentAnalyzer.js';
import { analyzeTechnical } from '../analyzers/technicalAnalyzer.js';
import { calculateWebsiteHealthScore } from './scoringService.js';
import { generateAuditPdf } from './pdfService.js';

export interface StartAuditOptions {
  url: string;
  userId?: string;
  websiteId?: string;
  guestSessionId?: string;
  maxPages?: number;
  crawlDepth?: number;
}

export class AuditService {
  /**
   * Starts a full website audit run
   */
  public static async startAudit(options: StartAuditOptions): Promise<IAudit> {
    const { url, userId, websiteId, guestSessionId, maxPages = 10, crawlDepth = 2 } = options;

    // 1. SSRF and URL validation
    const ssrf = await validateUrlForSSRF(url);
    if (!ssrf.isValid) {
      throw new Error(`Security validation failed: ${ssrf.reason}`);
    }

    const normalizedUrl = normalizeUrl(url);
    if (!normalizedUrl) {
      throw new Error('Invalid URL format');
    }

    // 2. Check user plan crawl limits
    let allowedMaxPages = maxPages;
    if (userId) {
      const user = await User.findById(userId);
      if (user && user.plan === 'free') {
        allowedMaxPages = Math.min(10, maxPages);
      } else if (user && user.plan === 'pro') {
        allowedMaxPages = Math.min(100, maxPages);
      }
    } else {
      // Guest scan default limit
      allowedMaxPages = Math.min(10, maxPages);
    }

    // 3. Create initial Audit record in DB
    const audit = new Audit({
      targetUrl: normalizedUrl,
      user: userId ? new mongoose.Types.ObjectId(userId) : undefined,
      website: websiteId ? new mongoose.Types.ObjectId(websiteId) : undefined,
      guestSessionId,
      maxPages: allowedMaxPages,
      crawlDepth,
      status: 'pending',
      currentStepMessage: 'Initializing audit engine...',
      progressPercent: 5,
      startedAt: new Date(),
    });

    await audit.save();

    // Trigger crawl and analysis asynchronously so client gets audit ID immediately
    this.executeAuditPipeline(audit._id.toString()).catch((err) => {
      console.error(`[AuditService] Execution error for audit ${audit._id}:`, err);
    });

    return audit;
  }

  /**
   * Pipeline execution: Crawl -> Analyze -> Score -> PDF
   */
  private static async executeAuditPipeline(auditId: string): Promise<void> {
    const audit = await Audit.findById(auditId);
    if (!audit) return;

    try {
      await Audit.findByIdAndUpdate(auditId, {
        status: 'crawling',
        progressPercent: 10,
        currentStepMessage: 'Crawler engine starting BFS traversal...',
      });

      const startTime = Date.now();

      // Crawler setup - high speed stream crawling
      const crawler = new CrawlerEngine({
        startUrl: audit.targetUrl,
        maxPages: audit.maxPages,
        maxDepth: audit.crawlDepth,
        enablePlaywrightRendering: false, // Fast, lightweight HTTP parsing (saves 20-30s on Render)
        onProgress: async (p) => {
          await Audit.findByIdAndUpdate(auditId, {
            pagesDiscovered: p.pagesDiscovered,
            pagesScanned: p.pagesScanned,
            currentStepMessage: p.stepMessage,
            progressPercent: p.progressPercent,
          }).catch(() => {});
        },
      });

      const crawledPages = await crawler.crawl();

      if (crawledPages.length === 0) {
        throw new Error('Target website could not be accessed or returned zero readable pages.');
      }

      await Audit.findByIdAndUpdate(auditId, {
        status: 'analyzing',
        currentStepMessage: `Crawled ${crawledPages.length} pages. Running multi-module diagnostic analysis...`,
        progressPercent: 70,
        pagesScanned: crawledPages.length,
      });

      let totalSeoScore = 0;
      let totalPerfScore = 0;
      let totalMobileScore = 0;
      let totalSecScore = 0;
      let totalTechScore = 0;
      let totalContentScore = 0;

      // Inspect SSL cert once for the domain
      const parsedStartUrl = new URL(audit.targetUrl);
      const sharedSslCert = await inspectSslCertificate(
        parsedStartUrl.hostname,
        parsedStartUrl.port ? parseInt(parsedStartUrl.port, 10) : 443
      );

      // Analyze all crawled pages in parallel for maximum speed
      const analyzedPagesData = await Promise.all(
        crawledPages.map(async (page) => {
          const pathname = new URL(page.url).pathname;

          const [seoResult, perfResult, mobileResult, secResult, brokenResult, contentResult, techResult] =
            await Promise.all([
              analyzeSeo(page.url, page.html, page.statusCode),
              analyzePerformance({
                url: page.url,
                html: page.html,
                headers: page.headers,
                responseTimeMs: page.responseTimeMs,
                pageSizeBytes: page.pageSizeBytes,
                browserMetrics: page.browserMetrics,
              }),
              analyzeMobileFromHtml(page.url, page.html),
              analyzeSecurity(page.url, page.html, page.headers, sharedSslCert),
              analyzeBrokenLinks(page.url, page.html, crawler.robotsTxtResult?.sitemapsFound[0] || audit.targetUrl, 4),
              analyzeContent(page.url, page.html),
              analyzeTechnical(page.url, page.html, page.statusCode, crawler.robotsTxtResult, crawler.sitemapResult),
            ]);

          const allPageIssues = [
            ...seoResult.issues,
            ...perfResult.issues,
            ...mobileResult.issues,
            ...secResult.issues,
            ...brokenResult.issues,
            ...contentResult.issues,
            ...techResult.issues,
          ];

          return {
            page,
            pathname,
            seoResult,
            perfResult,
            mobileResult,
            secResult,
            brokenResult,
            contentResult,
            techResult,
            allPageIssues,
          };
        })
      );

      // Prepare batch documents for high-speed bulk database insertion (single Atlas roundtrip)
      const pageDocsToInsert: any[] = [];
      const issueDocsToInsert: any[] = [];

      for (const item of analyzedPagesData) {
        const pageId = new mongoose.Types.ObjectId();

        totalSeoScore += item.seoResult.score;
        totalPerfScore += item.perfResult.score;
        totalMobileScore += item.mobileResult.score;
        totalSecScore += item.secResult.score;
        totalTechScore += item.techResult.score;
        totalContentScore += item.contentResult.score;

        pageDocsToInsert.push({
          _id: pageId,
          audit: audit._id,
          url: item.page.url,
          path: item.pathname,
          statusCode: item.page.statusCode,
          responseTimeMs: item.page.responseTimeMs,
          pageSizeBytes: item.page.pageSizeBytes,
          contentType: String(item.page.headers['content-type'] || 'text/html'),
          title: item.seoResult.details.title,
          metaDescription: item.seoResult.details.metaDescription,
          canonicalUrl: item.seoResult.details.canonicalUrl,
          h1Count: item.seoResult.details.h1s.length,
          h1Text: item.seoResult.details.h1s[0] || undefined,
          wordCount: item.contentResult.details.wordCount,
          internalLinksCount: item.page.internalLinksFound.length,
          externalLinksCount: item.page.externalLinksFound.length,
          imagesCount: item.seoResult.details.totalImages,
          missingAltCount: item.seoResult.details.missingAltCount,
          categoryScores: {
            seo: item.seoResult.score,
            performance: item.perfResult.score,
            mobile: item.mobileResult.score,
            security: item.secResult.score,
            technical: item.techResult.score,
            content: item.contentResult.score,
          },
          performanceMetrics: {
            fcp: item.perfResult.metrics.fcpMs,
            lcp: item.perfResult.metrics.lcpMs,
            cls: item.perfResult.metrics.cls,
            tbt: item.perfResult.metrics.tbtMs,
            speedIndex: item.perfResult.metrics.speedIndexMs,
            ttfb: item.perfResult.metrics.ttfbMs,
            totalRequests: item.perfResult.metrics.requestCount,
          },
          mobileFindings: {
            viewportConfigured: item.mobileResult.details.viewportConfigured,
            hasHorizontalOverflow: item.mobileResult.details.hasHorizontalOverflowMobile,
            overflowDetails: item.mobileResult.details.overflowElements,
            testedBreakpoints: item.mobileResult.details.testedBreakpoints,
          },
          securityHeaders: {
            hasHsts: item.secResult.details.hasHsts,
            hasCsp: item.secResult.details.hasCsp,
            hasXFrame: item.secResult.details.hasXFrame,
            hasXContentType: item.secResult.details.hasXContentType,
            hasReferrerPolicy: item.secResult.details.hasReferrerPolicy,
            hasPermissionsPolicy: item.secResult.details.hasPermissionsPolicy,
          },
        });

        for (const iss of item.allPageIssues) {
          issueDocsToInsert.push({
            audit: audit._id,
            pageAudit: pageId,
            category: iss.category,
            severity: iss.severity,
            issueCode: iss.issueCode,
            title: iss.title,
            url: iss.url,
            evidence: iss.evidence,
            whyItMatters: iss.whyItMatters,
            recommendation: iss.recommendation,
            priorityScore: iss.priorityScore,
            resolved: false,
          });
        }
      }

      // Execute bulk inserts concurrently in parallel
      const [savedPageAudits, savedIssues] = await Promise.all([
        PageAudit.insertMany(pageDocsToInsert),
        AuditIssue.insertMany(issueDocsToInsert),
      ]);

      // Compute overall website scores
      const pageCount = crawledPages.length || 1;
      const avgScores = {
        seo: Math.round(totalSeoScore / pageCount),
        performance: Math.round(totalPerfScore / pageCount),
        mobile: Math.round(totalMobileScore / pageCount),
        security: Math.round(totalSecScore / pageCount),
        technical: Math.round(totalTechScore / pageCount),
        content: Math.round(totalContentScore / pageCount),
      };

      const finalHealth = calculateWebsiteHealthScore(avgScores, savedIssues);

      // Check white-label settings if user is agency
      let whiteLabelOptions;
      if (audit.user) {
        const user = await User.findById(audit.user);
        if (user && user.plan === 'agency' && user.whiteLabelSettings) {
          whiteLabelOptions = {
            companyName: user.companyName || user.name,
            brandColor: user.whiteLabelSettings.brandColor,
            footerText: user.whiteLabelSettings.reportFooterText,
          };
        }
      }

      // Generate PDF Report
      let pdfPath: string | undefined;
      try {
        const tempAudit = { ...audit.toObject(), healthScore: finalHealth.overallHealthScore, categoryScores: finalHealth.categoryScores, issuesSummary: finalHealth.issuesSummary, pagesScanned: crawledPages.length } as any;
        pdfPath = await generateAuditPdf(
          tempAudit,
          savedPageAudits as unknown as IPageAudit[],
          savedIssues as unknown as IAuditIssue[],
          {
            whiteLabel: whiteLabelOptions,
          }
        );
      } catch (pdfErr: any) {
        console.error('[AuditService] PDF generation notice:', pdfErr.message);
      }

      await Audit.findByIdAndUpdate(auditId, {
        healthScore: finalHealth.overallHealthScore,
        categoryScores: finalHealth.categoryScores,
        issuesSummary: finalHealth.issuesSummary,
        pagesScanned: crawledPages.length,
        crawlDurationMs: Date.now() - startTime,
        status: 'completed',
        currentStepMessage: 'Audit complete! Report ready.',
        progressPercent: 100,
        completedAt: new Date(),
        pdfReportPath: pdfPath,
      });

      // Update Website record if linked
      if (audit.website) {
        await Website.findByIdAndUpdate(audit.website, {
          lastAuditId: audit._id,
          lastAuditDate: new Date(),
          healthScore: finalHealth.overallHealthScore,
        });
      }
    } catch (err: any) {
      await Audit.findByIdAndUpdate(auditId, {
        status: 'failed',
        errorMessage: err.message || 'Audit encountered an unexpected failure',
        currentStepMessage: `Failed: ${err.message || 'Error occurred'}`,
      }).catch(() => {});
      throw err;
    }
  }
}
