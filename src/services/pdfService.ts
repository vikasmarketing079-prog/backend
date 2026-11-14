import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import { IAudit } from '../models/Audit.js';
import { IPageAudit } from '../models/PageAudit.js';
import { IAuditIssue } from '../models/AuditIssue.js';
import { buildPrioritizedActionPlan } from './recommendationService.js';

export interface PdfOptions {
  whiteLabel?: {
    companyName?: string;
    brandColor?: string;
    footerText?: string;
  };
}

/**
 * Generates a comprehensive, professional PDF audit report
 */
export async function generateAuditPdf(
  audit: IAudit,
  pageAudits: IPageAudit[],
  issues: IAuditIssue[],
  options?: PdfOptions
): Promise<string> {
  const reportsDir = path.resolve(process.cwd(), 'reports');
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }

  const fileName = `audit_report_${audit._id}.pdf`;
  const filePath = path.join(reportsDir, fileName);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      margin: 50,
      size: 'A4',
      info: {
        Title: `SiteAudit Pro Report - ${audit.targetUrl}`,
        Author: options?.whiteLabel?.companyName || 'SiteAudit Pro',
      },
    });

    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    const primaryColor = options?.whiteLabel?.brandColor || '#0066FF';
    const darkNavy = '#0B132B';
    const grayText = '#4A5568';
    const lightBg = '#F8FAFC';

    // Helper: Header
    doc.rect(0, 0, doc.page.width, 100).fill(darkNavy);
    doc.fillColor('#FFFFFF').fontSize(22).font('Helvetica-Bold').text(
      options?.whiteLabel?.companyName || 'SiteAudit Pro',
      50,
      30
    );
    doc.fontSize(10).font('Helvetica').fillColor('#94A3B8').text(
      'Comprehensive Website Health & Performance Audit',
      50,
      60
    );
    doc.text(
      `Generated: ${new Date().toLocaleDateString('en-US', { dateStyle: 'long' })}`,
      doc.page.width - 250,
      35,
      { align: 'right', width: 200 }
    );

    doc.moveDown(4);

    // Section 1: Executive Summary Card
    const cardTop = 120;
    doc.roundedRect(50, cardTop, doc.page.width - 100, 110, 8).fillAndStroke(lightBg, '#E2E8F0');

    doc.fillColor(darkNavy).fontSize(12).font('Helvetica-Bold').text('TARGET WEBSITE AUDITED:', 70, cardTop + 20);
    doc.fillColor(primaryColor).fontSize(14).text(audit.targetUrl, 70, cardTop + 36);

    doc.fillColor(grayText).fontSize(10).font('Helvetica').text(
      `Pages Crawled: ${audit.pagesScanned}  |  Total Issues: ${audit.issuesSummary.total}  |  Critical: ${audit.issuesSummary.critical}  |  High: ${audit.issuesSummary.high}`,
      70,
      cardTop + 65
    );

    // Health Score Badge
    const scoreColor = audit.healthScore >= 80 ? '#10B981' : audit.healthScore >= 60 ? '#F59E0B' : '#EF4444';
    doc.roundedRect(doc.page.width - 160, cardTop + 15, 90, 80, 8).fill(scoreColor);
    doc.fillColor('#FFFFFF').fontSize(28).font('Helvetica-Bold').text(
      String(audit.healthScore),
      doc.page.width - 160,
      cardTop + 30,
      { width: 90, align: 'center' }
    );
    doc.fontSize(9).font('Helvetica').text('HEALTH SCORE', doc.page.width - 160, cardTop + 65, {
      width: 90,
      align: 'center',
    });

    // Section 2: Category Scores Breakdown
    let yPos = cardTop + 130;
    doc.fillColor(darkNavy).fontSize(14).font('Helvetica-Bold').text('Category Scores Breakdown', 50, yPos);
    yPos += 22;

    const categories = [
      { name: 'SEO Health (25%)', score: audit.categoryScores.seo },
      { name: 'Performance (25%)', score: audit.categoryScores.performance },
      { name: 'Mobile Readiness (20%)', score: audit.categoryScores.mobile },
      { name: 'Security Config (15%)', score: audit.categoryScores.security },
      { name: 'Technical Setup (10%)', score: audit.categoryScores.technical },
      { name: 'Content Structure (5%)', score: audit.categoryScores.content },
    ];

    const colWidth = (doc.page.width - 100) / 3;
    categories.forEach((cat, idx) => {
      const col = idx % 3;
      const row = Math.floor(idx / 3);
      const bx = 50 + col * colWidth;
      const by = yPos + row * 55;

      doc.roundedRect(bx, by, colWidth - 10, 45, 6).fillAndStroke('#FFFFFF', '#E2E8F0');
      doc.fillColor(grayText).fontSize(9).font('Helvetica').text(cat.name, bx + 10, by + 8);
      const catColor = cat.score >= 80 ? '#10B981' : cat.score >= 60 ? '#F59E0B' : '#EF4444';
      doc.fillColor(catColor).fontSize(16).font('Helvetica-Bold').text(`${cat.score}/100`, bx + 10, by + 22);
    });

    // Section 3: Prioritized Action Plan
    yPos += 135;
    doc.fillColor(darkNavy).fontSize(14).font('Helvetica-Bold').text('Prioritized Action Plan', 50, yPos);
    yPos += 20;

    const actionPlan = buildPrioritizedActionPlan(issues);
    const topPriorities = actionPlan.slice(0, 6);

    if (topPriorities.length === 0) {
      doc.fillColor(grayText).fontSize(10).font('Helvetica').text('No high-priority defects detected! Excellent job.', 50, yPos);
    } else {
      topPriorities.forEach((item) => {
        if (yPos > doc.page.height - 100) {
          doc.addPage();
          yPos = 50;
        }

        const sevColor = item.severity === 'critical' ? '#EF4444' : item.severity === 'high' ? '#F97316' : '#EAB308';
        doc.circle(60, yPos + 6, 4).fill(sevColor);
        doc.fillColor(darkNavy).fontSize(11).font('Helvetica-Bold').text(
          `Priority ${item.priority}: ${item.title}`,
          75,
          yPos
        );
        yPos += 16;
        doc.fillColor(grayText).fontSize(9).font('Helvetica').text(
          `Why it matters: ${item.whyItMatters.slice(0, 160)}...`,
          75,
          yPos,
          { width: doc.page.width - 130 }
        );
        yPos += 22;
        doc.fillColor(primaryColor).fontSize(9).font('Helvetica-Bold').text(
          `Action: ${item.recommendation.slice(0, 160)}...`,
          75,
          yPos,
          { width: doc.page.width - 130 }
        );
        yPos += 30;
      });
    }

    // Page 2: Audited Pages Table
    doc.addPage();
    doc.fillColor(darkNavy).fontSize(14).font('Helvetica-Bold').text('Audited Pages Breakdown', 50, 50);

    let pageY = 75;
    // Table Header
    doc.rect(50, pageY, doc.page.width - 100, 22).fill('#F1F5F9');
    doc.fillColor(darkNavy).fontSize(9).font('Helvetica-Bold').text('URL Path', 55, pageY + 6);
    doc.text('Status', doc.page.width - 240, pageY + 6);
    doc.text('Response', doc.page.width - 180, pageY + 6);
    doc.text('Page Size', doc.page.width - 110, pageY + 6);
    pageY += 25;

    pageAudits.slice(0, 25).forEach((p) => {
      if (pageY > doc.page.height - 70) {
        doc.addPage();
        pageY = 50;
      }
      doc.fillColor(grayText).fontSize(8).font('Helvetica').text(
        p.path.length > 40 ? p.path.slice(0, 38) + '...' : p.path,
        55,
        pageY
      );
      doc.text(String(p.statusCode), doc.page.width - 240, pageY);
      doc.text(`${p.responseTimeMs}ms`, doc.page.width - 180, pageY);
      doc.text(`${(p.pageSizeBytes / 1024).toFixed(1)} KB`, doc.page.width - 110, pageY);
      pageY += 18;
    });

    // Footer
    const footerText = options?.whiteLabel?.footerText || 'SiteAudit Pro Automated Health Audit Report';
    doc.fontSize(8).fillColor('#94A3B8').text(
      footerText,
      50,
      doc.page.height - 40,
      { align: 'center', width: doc.page.width - 100 }
    );

    stream.on('finish', () => resolve(filePath));
    stream.on('error', (err: any) => reject(err));
    doc.on('error', (err: any) => reject(err));

    doc.end();
  });
}

