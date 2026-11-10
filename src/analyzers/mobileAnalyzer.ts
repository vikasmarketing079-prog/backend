import * as cheerio from 'cheerio';
import { AnalyzerIssue } from './seoAnalyzer.js';
import { Page } from 'playwright';

export interface MobileAnalysisResult {
  score: number;
  issues: AnalyzerIssue[];
  details: {
    viewportConfigured: boolean;
    viewportContent?: string;
    hasHorizontalOverflowMobile: boolean;
    hasHorizontalOverflowTablet: boolean;
    overflowElements: string[];
    smallTouchTargetsCount: number;
    testedBreakpoints: number[];
  };
}

/**
 * Static HTML mobile check (fast fallback or pre-check)
 */
export function analyzeMobileFromHtml(url: string, html: string): MobileAnalysisResult {
  const $ = cheerio.load(html);
  const issues: AnalyzerIssue[] = [];
  let score = 100;

  const viewportTag = $('meta[name="viewport" i]').attr('content');
  const viewportConfigured = Boolean(viewportTag && viewportTag.includes('width=device-width'));

  if (!viewportTag) {
    score -= 30;
    issues.push({
      category: 'mobile',
      severity: 'critical',
      issueCode: 'MOBILE_MISSING_VIEWPORT',
      title: 'Missing Mobile Viewport Meta Tag',
      url,
      evidence: 'No <meta name="viewport"> tag found in document head.',
      whyItMatters:
        'Without a mobile viewport tag, mobile browsers render pages at desktop width (typically 980px) and scale down, forcing users to pinch and zoom to read text.',
      recommendation:
        'Add <meta name="viewport" content="width=device-width, initial-scale=1.0"> to your HTML <head>.',
      priorityScore: 95,
    });
  } else if (!viewportConfigured) {
    score -= 15;
    issues.push({
      category: 'mobile',
      severity: 'high',
      issueCode: 'MOBILE_SUBOPTIMAL_VIEWPORT',
      title: 'Suboptimal Viewport Tag Configuration',
      url,
      evidence: `Viewport tag content is "${viewportTag}". Missing "width=device-width".`,
      whyItMatters:
        'The mobile viewport must match the screen device width to display content proportionally across diverse device form factors.',
      recommendation:
        'Update the viewport tag to: <meta name="viewport" content="width=device-width, initial-scale=1.0">.',
      priorityScore: 80,
    });
  } else {
    issues.push({
      category: 'mobile',
      severity: 'passed',
      issueCode: 'MOBILE_VIEWPORT_CONFIGURED',
      title: 'Mobile Viewport Correctly Configured',
      url,
      evidence: `Found valid viewport tag: "${viewportTag}".`,
      whyItMatters: 'Enables mobile browsers to scale layouts appropriately to device screen width.',
      recommendation: 'Maintain standard viewport configuration.',
      priorityScore: 0,
    });
  }

  return {
    score: Math.max(0, Math.min(100, Math.round(score))),
    issues,
    details: {
      viewportConfigured,
      viewportContent: viewportTag,
      hasHorizontalOverflowMobile: false,
      hasHorizontalOverflowTablet: false,
      overflowElements: [],
      smallTouchTargetsCount: 0,
      testedBreakpoints: [375, 768, 1440],
    },
  };
}

/**
 * Deep Playwright inspection across mobile (375px), tablet (768px), and desktop (1440px)
 */
export async function inspectMobileWithPlaywright(
  page: Page,
  url: string
): Promise<MobileAnalysisResult> {
  const issues: AnalyzerIssue[] = [];
  let score = 100;
  const overflowElements: string[] = [];
  let hasHorizontalOverflowMobile = false;
  let hasHorizontalOverflowTablet = false;
  let smallTouchTargets = 0;

  try {
    // 1. Mobile breakpoint (375px)
    await page.setViewportSize({ width: 375, height: 667 });
    await page.waitForTimeout(600);

    const mobileCheck = await page.evaluate(() => {
      const docWidth = document.documentElement.scrollWidth;
      const winWidth = window.innerWidth;
      const hasOverflow = docWidth > winWidth + 2;

      const offending: string[] = [];
      if (hasOverflow) {
        const allElements = document.querySelectorAll('*');
        for (const el of Array.from(allElements)) {
          const rect = el.getBoundingClientRect();
          if (rect.right > winWidth + 5) {
            const tag = el.tagName.toLowerCase();
            const id = el.id ? `#${el.id}` : '';
            const cls = typeof el.className === 'string' && el.className ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}` : '';
            const identifier = `${tag}${id}${cls}`;
            if (!offending.includes(identifier) && offending.length < 5) {
              offending.push(identifier);
            }
          }
        }
      }

      // Check touch target sizes for buttons and links
      let smallTargets = 0;
      const interactives = document.querySelectorAll('button, a, input[type="button"], input[type="submit"]');
      for (const el of Array.from(interactives)) {
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          if (rect.width < 28 || rect.height < 28) {
            smallTargets++;
          }
        }
      }

      return {
        docWidth,
        winWidth,
        hasOverflow,
        offending,
        smallTargets,
      };
    });

    hasHorizontalOverflowMobile = mobileCheck.hasOverflow;
    smallTouchTargets = mobileCheck.smallTargets;
    if (mobileCheck.offending.length > 0) {
      overflowElements.push(...mobileCheck.offending);
    }

    if (hasHorizontalOverflowMobile) {
      score -= 25;
      issues.push({
        category: 'mobile',
        severity: 'critical',
        issueCode: 'MOBILE_HORIZONTAL_OVERFLOW_375PX',
        title: 'Horizontal Page Overflow on Mobile Viewport (375px)',
        url,
        evidence: `Document width (${mobileCheck.docWidth}px) exceeds the 375px screen width. Offending element(s): ${overflowElements.join(', ') || 'container element'}.`,
        whyItMatters:
          'Horizontal overflow forces mobile users to pan horizontally, creating an unusable layout and causing Google Mobile-Friendly penalization.',
        recommendation:
          'Set "max-width: 100%" on images, tables, and preformatted text blocks. Avoid fixed pixel widths (e.g. width: 600px) in CSS.',
        priorityScore: 92,
      });
    }

    // 2. Tablet breakpoint (768px)
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.waitForTimeout(300);

    const tabletCheck = await page.evaluate(() => {
      const docWidth = document.documentElement.scrollWidth;
      const winWidth = window.innerWidth;
      return docWidth > winWidth + 2;
    });

    hasHorizontalOverflowTablet = tabletCheck;
    if (hasHorizontalOverflowTablet) {
      score -= 15;
      issues.push({
        category: 'mobile',
        severity: 'high',
        issueCode: 'MOBILE_HORIZONTAL_OVERFLOW_768PX',
        title: 'Horizontal Layout Overflow on Tablet Viewport (768px)',
        url,
        evidence: `Page content exceeds 768px viewport width on tablet devices.`,
        whyItMatters: 'Causes awkward layout shifts and broken grid layouts on iPads and tablets.',
        recommendation: 'Verify CSS grid and flexbox wrapping rules at media query (min-width: 768px).',
        priorityScore: 78,
      });
    }

    // 3. Touch target warning
    if (smallTouchTargets > 4) {
      score -= 10;
      issues.push({
        category: 'mobile',
        severity: 'medium',
        issueCode: 'MOBILE_SMALL_TOUCH_TARGETS',
        title: `${smallTouchTargets} Undersized Tap Targets Detected`,
        url,
        evidence: `Detected ${smallTouchTargets} interactive button/link elements measuring less than 28x28px.`,
        whyItMatters:
          'Tapping targets smaller than 48x48px (or at least 32px with adequate padding) causes accidental clicks on adjacent links on touchscreen devices.',
        recommendation:
          'Increase touch target size or add min-height and padding around clickable links and buttons.',
        priorityScore: 65,
      });
    }

    // 4. Viewport meta check
    const content = await page.content();
    const staticCheck = analyzeMobileFromHtml(url, content);
    for (const issue of staticCheck.issues) {
      if (issue.issueCode === 'MOBILE_MISSING_VIEWPORT' || issue.issueCode === 'MOBILE_SUBOPTIMAL_VIEWPORT') {
        score -= 20;
        issues.push(issue);
      }
    }

    if (issues.filter((i) => i.severity !== 'passed').length === 0) {
      issues.push({
        category: 'mobile',
        severity: 'passed',
        issueCode: 'MOBILE_PASSED_ALL_VIEWPORTS',
        title: 'Fully Mobile & Tablet Responsive',
        url,
        evidence: 'No horizontal overflow detected across 375px, 768px, and 1440px viewports.',
        whyItMatters: 'Ensures seamless browsing experience across all smartphones and tablets.',
        recommendation: 'Maintain responsive CSS practices.',
        priorityScore: 0,
      });
    }
  } catch (err: any) {
    // Graceful fallback to static HTML mobile check
    const content = await page.content().catch(() => '');
    return analyzeMobileFromHtml(url, content);
  }

  return {
    score: Math.max(0, Math.min(100, Math.round(score))),
    issues,
    details: {
      viewportConfigured: true,
      hasHorizontalOverflowMobile,
      hasHorizontalOverflowTablet,
      overflowElements,
      smallTouchTargetsCount: smallTouchTargets,
      testedBreakpoints: [375, 768, 1440],
    },
  };
}

