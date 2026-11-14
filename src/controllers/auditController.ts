import { Request, Response } from 'express';
import mongoose from 'mongoose';
import fs from 'fs';
import { Audit } from '../models/Audit.js';
import { PageAudit } from '../models/PageAudit.js';
import { AuditIssue } from '../models/AuditIssue.js';
import { AuditService } from '../services/auditService.js';
import { buildPrioritizedActionPlan } from '../services/recommendationService.js';
import { sendEmailNotification } from '../services/emailService.js';

export class AuditController {
  /**
   * Starts a new audit
   */
  public static async start(req: Request, res: Response): Promise<void> {
    try {
      const { url, maxPages, crawlDepth, websiteId } = req.body;
      const userId = (req as any).user?.id;
      const guestSessionId = req.headers['x-guest-session-id'] as string;

      if (!url) {
        res.status(400).json({ success: false, error: 'A valid website URL is required.' });
        return;
      }

      const audit = await AuditService.startAudit({
        url,
        userId,
        websiteId,
        guestSessionId,
        maxPages: maxPages ? parseInt(maxPages, 10) : undefined,
        crawlDepth: crawlDepth ? parseInt(crawlDepth, 10) : undefined,
      });

      res.status(201).json({
        success: true,
        data: {
          auditId: audit._id,
          targetUrl: audit.targetUrl,
          status: audit.status,
          progressPercent: audit.progressPercent,
          currentStepMessage: audit.currentStepMessage,
        },
      });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message || 'Could not start audit' });
    }
  }

  /**
   * Gets audit details and action plan
   */
  public static async getById(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const audit = await Audit.findById(id);

      if (!audit) {
        res.status(404).json({ success: false, error: 'Audit record not found' });
        return;
      }

      const issues = await AuditIssue.find({ audit: audit._id });
      const actionPlan = buildPrioritizedActionPlan(issues);

      res.json({
        success: true,
        data: {
          audit,
          actionPlan,
        },
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  /**
   * Real-time progress endpoint (polling)
   */
  public static async getProgress(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const audit = await Audit.findById(id).select(
        'status progressPercent currentStepMessage pagesDiscovered pagesScanned healthScore categoryScores errorMessage completedAt'
      );

      if (!audit) {
        res.status(404).json({ success: false, error: 'Audit not found' });
        return;
      }

      res.json({
        success: true,
        data: audit,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  /**
   * Retrieves list of issues with filtering
   */
  public static async getIssues(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const { category, severity, search } = req.query;

      const query: any = { audit: id };
      if (category && category !== 'all') {
        query.category = category;
      }
      if (severity && severity !== 'all') {
        query.severity = severity;
      }
      if (search) {
        query.$or = [
          { title: { $regex: String(search), $options: 'i' } },
          { evidence: { $regex: String(search), $options: 'i' } },
          { url: { $regex: String(search), $options: 'i' } },
        ];
      }

      const issues = await AuditIssue.find(query).sort({ priorityScore: -1 });

      res.json({
        success: true,
        count: issues.length,
        data: issues,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  /**
   * Retrieves page audits
   */
  public static async getPages(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const pages = await PageAudit.find({ audit: id }).sort({ responseTimeMs: -1 });

      res.json({
        success: true,
        count: pages.length,
        data: pages,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  /**
   * Downloads PDF report
   */
  public static async downloadPdf(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const audit = await Audit.findById(id);

      if (!audit || !audit.pdfReportPath || !fs.existsSync(audit.pdfReportPath)) {
        res.status(404).json({ success: false, error: 'PDF report not found or scan not yet completed' });
        return;
      }

      res.download(audit.pdfReportPath, `SiteAuditPro_${new URL(audit.targetUrl).hostname}_Report.pdf`);
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  /**
   * Rescans an existing website
   */
  public static async rescan(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const previousAudit = await Audit.findById(id);

      if (!previousAudit) {
        res.status(404).json({ success: false, error: 'Previous audit not found' });
        return;
      }

      const newAudit = await AuditService.startAudit({
        url: previousAudit.targetUrl,
        userId: previousAudit.user?.toString(),
        websiteId: previousAudit.website?.toString(),
        maxPages: previousAudit.maxPages,
        crawlDepth: previousAudit.crawlDepth,
      });

      res.status(201).json({
        success: true,
        data: {
          auditId: newAudit._id,
          targetUrl: newAudit.targetUrl,
          status: newAudit.status,
        },
      });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  }

  /**
   * Compares two audits to show progress, score changes, and resolved issues
   */
  public static async compare(req: Request, res: Response): Promise<void> {
    try {
      const { id, previousAuditId } = req.params;

      const current = await Audit.findById(id);
      const previous = await Audit.findById(previousAuditId);

      if (!current || !previous) {
        res.status(404).json({ success: false, error: 'One or both audits were not found' });
        return;
      }

      const currentIssues = await AuditIssue.find({ audit: current._id });
      const previousIssues = await AuditIssue.find({ audit: previous._id });

      const currentCodes = new Set(currentIssues.map((i) => `${i.issueCode}_${i.url}`));
      const previousCodes = new Set(previousIssues.map((i) => `${i.issueCode}_${i.url}`));

      // Resolved issues: present in previous, absent in current
      const resolved = previousIssues.filter(
        (i) => i.severity !== 'passed' && !currentCodes.has(`${i.issueCode}_${i.url}`)
      );

      // New issues: present in current, absent in previous
      const newIssues = currentIssues.filter(
        (i) => i.severity !== 'passed' && !previousCodes.has(`${i.issueCode}_${i.url}`)
      );

      const healthScoreDiff = current.healthScore - previous.healthScore;

      res.json({
        success: true,
        data: {
          current: {
            id: current._id,
            date: current.createdAt,
            healthScore: current.healthScore,
            categoryScores: current.categoryScores,
            issuesSummary: current.issuesSummary,
          },
          previous: {
            id: previous._id,
            date: previous.createdAt,
            healthScore: previous.healthScore,
            categoryScores: previous.categoryScores,
            issuesSummary: previous.issuesSummary,
          },
          healthScoreDiff,
          resolvedIssuesCount: resolved.length,
          newIssuesCount: newIssues.length,
          resolved,
          newIssues,
        },
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  /**
   * Emails the audit report
   */
  public static async emailReport(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const { email } = req.body;

      if (!email) {
        res.status(400).json({ success: false, error: 'Recipient email address is required' });
        return;
      }

      const audit = await Audit.findById(id);
      if (!audit) {
        res.status(404).json({ success: false, error: 'Audit not found' });
        return;
      }

      const emailResult = await sendEmailNotification({
        to: email,
        subject: `Your SiteAudit Pro Report for ${audit.targetUrl} is Ready!`,
        html: `
          <h2>SiteAudit Pro Website Health Report</h2>
          <p>Website: <strong>${audit.targetUrl}</strong></p>
          <p>Overall Health Score: <strong>${audit.healthScore}/100</strong></p>
          <p>Total Issues Detected: <strong>${audit.issuesSummary.total}</strong> (Critical: ${audit.issuesSummary.critical}, High: ${audit.issuesSummary.high})</p>
          <p>Log in to your SiteAudit Pro dashboard to view the complete prioritized action plan and download the PDF report.</p>
        `,
        attachmentPath: audit.pdfReportPath,
      });

      res.json({
        success: true,
        message: emailResult.message,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  /**
   * Clearly-labeled demonstration audit endpoint for instant interactive testing
   */
  public static async getDemo(req: Request, res: Response): Promise<void> {
    try {
      let demoAudit = await Audit.findOne({ isDemo: true });

      if (!demoAudit) {
        // Create realistic demo audit
        demoAudit = new Audit({
          targetUrl: 'https://demo-ecommerce-store.example.com',
          maxPages: 10,
          crawlDepth: 2,
          status: 'completed',
          progressPercent: 100,
          currentStepMessage: 'Audit complete! Demonstration data active.',
          healthScore: 74,
          categoryScores: {
            seo: 78,
            performance: 62,
            mobile: 85,
            security: 70,
            technical: 82,
            content: 68,
          },
          issuesSummary: {
            critical: 3,
            high: 7,
            medium: 12,
            low: 9,
            passed: 24,
            total: 31,
          },
          pagesDiscovered: 28,
          pagesScanned: 10,
          crawlDurationMs: 4200,
          startedAt: new Date(Date.now() - 3600000),
          completedAt: new Date(Date.now() - 3550000),
          isDemo: true,
        });
        await demoAudit.save();

        // Seed sample demo issues
        const sampleDemoIssues = [
          {
            audit: demoAudit._id,
            category: 'broken_link',
            severity: 'critical',
            issueCode: 'LINK_INTERNAL_BROKEN',
            title: 'Broken Internal 404 Link on Checkout Button',
            url: 'https://demo-ecommerce-store.example.com/cart',
            evidence: 'Checkout button links to /checkout-v2 which returned HTTP 404 Not Found.',
            whyItMatters: 'Directly halts customers during purchase flow, preventing conversions.',
            recommendation: 'Update destination URL to /checkout or configure a 301 redirect.',
            priorityScore: 99,
          },
          {
            audit: demoAudit._id,
            category: 'performance',
            severity: 'critical',
            issueCode: 'PERF_POOR_LCP',
            title: 'Uncompressed Hero Banner Delaying LCP to 4.6s',
            url: 'https://demo-ecommerce-store.example.com',
            evidence: 'Hero image "hero-banner.png" is 3.8 MB with no WebP format or explicit dimension attributes.',
            whyItMatters: 'Visitors abandon pages that take longer than 3 seconds to render on mobile networks.',
            recommendation: 'Convert to modern WebP format (saving ~85% file size) and add <link rel="preload">.',
            priorityScore: 95,
          },
          {
            audit: demoAudit._id,
            category: 'security',
            severity: 'critical',
            issueCode: 'SEC_MIXED_CONTENT',
            title: 'Insecure HTTP Font Loaded on Secure HTTPS Page',
            url: 'https://demo-ecommerce-store.example.com',
            evidence: 'Found stylesheet link requesting "http://fonts.example.net/custom.css".',
            whyItMatters: 'Browsers block mixed content scripts/styles, breaking visual design layout.',
            recommendation: 'Update all resource URLs to use https:// scheme.',
            priorityScore: 92,
          },
          {
            audit: demoAudit._id,
            category: 'seo',
            severity: 'high',
            issueCode: 'SEO_MISSING_META_DESCRIPTION',
            title: 'Missing Meta Descriptions on 4 Key Product Pages',
            url: 'https://demo-ecommerce-store.example.com/products/all',
            evidence: 'No <meta name="description"> tag was defined.',
            whyItMatters: 'Search engines display random snippets instead of compelling marketing copy.',
            recommendation: 'Add targeted meta descriptions between 120 and 155 characters.',
            priorityScore: 84,
          },
          {
            audit: demoAudit._id,
            category: 'mobile',
            severity: 'high',
            issueCode: 'MOBILE_HORIZONTAL_OVERFLOW_375PX',
            title: 'Product Comparison Table Overflows 375px Mobile Viewport',
            url: 'https://demo-ecommerce-store.example.com/compare',
            evidence: 'Table element #specs-table has fixed min-width: 650px causing horizontal viewport overflow.',
            whyItMatters: 'Forces users to scroll sideways, triggering mobile usability warnings in Google Search Console.',
            recommendation: 'Wrap table in an overflow-x-auto container with touch-scrolling enabled.',
            priorityScore: 82,
          },
        ];

        await AuditIssue.insertMany(sampleDemoIssues);
      }

      const issues = await AuditIssue.find({ audit: demoAudit._id });
      const actionPlan = buildPrioritizedActionPlan(issues);

      res.json({
        success: true,
        data: {
          audit: demoAudit,
          actionPlan,
        },
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  /**
   * Export all issues to CSV for team / client spreadsheets
   */
  public static async exportCsv(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const audit = await Audit.findById(id);
      if (!audit) {
        res.status(404).json({ success: false, error: 'Audit not found' });
        return;
      }

      const issues = await AuditIssue.find({ audit: audit._id }).sort({ priorityScore: -1 });

      const escapeCsv = (str: string) => `"${(str || '').replace(/"/g, '""')}"`;

      let csv = 'Severity,Category,Title,Affected URL,Evidence,Why It Matters,Recommended Fix,Status\n';
      for (const iss of issues) {
        csv += [
          escapeCsv(iss.severity),
          escapeCsv(iss.category),
          escapeCsv(iss.title),
          escapeCsv(iss.url),
          escapeCsv(iss.evidence),
          escapeCsv(iss.whyItMatters),
          escapeCsv(iss.recommendation),
          escapeCsv(iss.resolved ? 'Resolved' : 'Open'),
        ].join(',') + '\n';
      }

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="siteaudit_issues_${new URL(audit.targetUrl).hostname}.csv"`);
      res.send(csv);
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  /**
   * Export full audit report as JSON
   */
  public static async exportJson(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const audit = await Audit.findById(id);
      if (!audit) {
        res.status(404).json({ success: false, error: 'Audit not found' });
        return;
      }

      const [issues, pages] = await Promise.all([
        AuditIssue.find({ audit: audit._id }),
        PageAudit.find({ audit: audit._id }),
      ]);
      const actionPlan = buildPrioritizedActionPlan(issues);

      res.json({
        success: true,
        audit,
        pages,
        issues,
        actionPlan,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  /**
   * Toggle issue resolution status
   */
  public static async toggleIssueResolved(req: Request, res: Response): Promise<void> {
    try {
      const { issueId } = req.params;
      const issue = await AuditIssue.findById(issueId);
      if (!issue) {
        res.status(404).json({ success: false, error: 'Issue not found' });
        return;
      }

      issue.resolved = !issue.resolved;
      await issue.save();

      res.json({
        success: true,
        data: issue,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }
}

