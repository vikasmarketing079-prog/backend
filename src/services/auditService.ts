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
import { analyzeSecurity } from '../analyzers/securityAnalyzer.js';
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

      // Crawler setup
      const crawler = new CrawlerEngine({
        startUrl: audit.targetUrl,
        maxPages: audit.maxPages,
        maxDepth: audit.crawlDepth,
        enablePlaywrightRendering: true,
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

      const savedPageAudits: IPageAudit[] = [];
      const savedIssues: IAuditIssue[] = [];

      let totalSeoScore = 0;
      let totalPerfScore = 0;
      let totalMobileScore = 0;
      let totalSecScore = 0;
      let totalTechScore = 0;
      let totalContentScore = 0;

      // Analyze each crawled page
      for (let i = 0; i < crawledPages.length; i++) {
        const page = crawledPages[i];
        const pathname = new URL(page.url).pathname;

        // Run analyzers
        const seoResult = analyzeSeo(page.url, page.html, page.statusCode);
        const perfResult = analyzePerformance({
          url: page.url,
          html: page.html,
          headers: page.headers,
          responseTimeMs: page.responseTimeMs,
          pageSizeBytes: page.pageSizeBytes,
          browserMetrics: page.browserMetrics,
        });
        const mobileResult = analyzeMobileFromHtml(page.url, page.html);
        const secResult = await analyzeSecurity(page.url, page.html, page.headers);
        const brokenResult = await analyzeBrokenLinks(page.url, page.html, crawler.robotsTxtResult?.sitemapsFound[0] || audit.targetUrl, 10);
        const contentResult = analyzeContent(page.url, page.html);
        const techResult = await analyzeTechnical(
          page.url,
          page.html,
          page.statusCode,
          crawler.robotsTxtResult,
          crawler.sitemapResult
        );

        // Accumulate scores for average
        totalSeoScore += seoResult.score;
        totalPerfScore += perfResult.score;
        totalMobileScore += mobileResult.score;
        totalSecScore += secResult.score;
        totalTechScore += techResult.score;
        totalContentScore += contentResult.score;

        // Save PageAudit record
        const pageAudit = new PageAudit({
          audit: audit._id,
          url: page.url,
          path: pathname,
          statusCode: page.statusCode,
          responseTimeMs: page.responseTimeMs,
          pageSizeBytes: page.pageSizeBytes,
          contentType: String(page.headers['content-type'] || 'text/html'),
          title: seoResult.details.title,
          metaDescription: seoResult.details.metaDescription,
          canonicalUrl: seoResult.details.canonicalUrl,
          h1Count: seoResult.details.h1s.length,
          wordCount: contentResult.details.wordCount,
          internalLinksCount: page.internalLinksFound.length,
          externalLinksCount: page.externalLinksFound.length,
          imagesCount: seoResult.details.totalImages,
          missingAltCount: seoResult.details.missingAltCount,
          categoryScores: {
            seo: seoResult.score,
            performance: perfResult.score,
            mobile: mobileResult.score,
            security: secResult.score,
            technical: techResult.score,
            content: contentResult.score,
          },
          performanceMetrics: {
            fcp: perfResult.metrics.fcpMs,
            lcp: perfResult.metrics.lcpMs,
            cls: perfResult.metrics.cls,
            tbt: perfResult.metrics.tbtMs,
            speedIndex: perfResult.metrics.speedIndexMs,
            ttfb: perfResult.metrics.ttfbMs,
            totalRequests: perfResult.metrics.requestCount,
          },
          mobileFindings: {
            viewportConfigured: mobileResult.details.viewportConfigured,
            hasHorizontalOverflow: mobileResult.details.hasHorizontalOverflowMobile,
            overflowDetails: mobileResult.details.overflowElements,
            testedBreakpoints: mobileResult.details.testedBreakpoints,
          },
          securityHeaders: {
            hasHsts: secResult.details.hasHsts,
            hasCsp: secResult.details.hasCsp,
            hasXFrame: secResult.details.hasXFrame,
            hasXContentType: secResult.details.hasXContentType,
            hasReferrerPolicy: secResult.details.hasReferrerPolicy,
            hasPermissionsPolicy: secResult.details.hasPermissionsPolicy,
          },
        });

        await pageAudit.save();
        savedPageAudits.push(pageAudit);

        // Aggregate issues from all modules for this page
        const allPageIssues = [
          ...seoResult.issues,
          ...perfResult.issues,
          ...mobileResult.issues,
          ...secResult.issues,
          ...brokenResult.issues,
          ...contentResult.issues,
          ...techResult.issues,
        ];

        for (const item of allPageIssues) {
          const auditIssue = new AuditIssue({
            audit: audit._id,
            pageAudit: pageAudit._id,
            category: item.category,
            severity: item.severity,
            issueCode: item.issueCode,
            title: item.title,
            url: item.url,
            evidence: item.evidence,
            whyItMatters: item.whyItMatters,
            recommendation: item.recommendation,
            priorityScore: item.priorityScore,
            resolved: false,
          });
          await auditIssue.save();
          savedIssues.push(auditIssue);
        }
      }

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
        pdfPath = await generateAuditPdf(tempAudit, savedPageAudits, savedIssues, {
          whiteLabel: whiteLabelOptions,
        });
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
