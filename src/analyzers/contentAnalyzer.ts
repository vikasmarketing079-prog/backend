import * as cheerio from 'cheerio';
import { AnalyzerIssue } from './seoAnalyzer.js';

export interface ContentAnalysisResult {
  score: number;
  issues: AnalyzerIssue[];
  details: {
    wordCount: number;
    isThinContent: boolean;
    htmlLang?: string;
    hasLanguageAttribute: boolean;
    internalOutboundLinks: number;
    externalOutboundLinks: number;
    paragraphCount: number;
  };
}

export function analyzeContent(url: string, html: string): ContentAnalysisResult {
  const $ = cheerio.load(html);
  const issues: AnalyzerIssue[] = [];
  let score = 100;

  // 1. Language Declaration Check
  const htmlLang = $('html').attr('lang')?.trim();
  const hasLanguageAttribute = Boolean(htmlLang);

  if (!hasLanguageAttribute) {
    score -= 15;
    issues.push({
      category: 'content',
      severity: 'medium',
      issueCode: 'CONTENT_MISSING_LANG',
      title: 'Missing HTML Language Attribute',
      url,
      evidence: 'The <html> tag has no "lang" attribute specified (e.g. <html lang="en">).',
      whyItMatters:
        'Screen readers rely on the lang attribute to pronounce text in the correct accent and dialect. Search engines also use it for geo-targeting and multilingual ranking.',
      recommendation:
        'Add the appropriate language code to your root tag, e.g. <html lang="en"> or <html lang="es">.',
      priorityScore: 70,
    });
  } else {
    issues.push({
      category: 'content',
      severity: 'passed',
      issueCode: 'CONTENT_LANG_CONFIGURED',
      title: 'HTML Language Declared',
      url,
      evidence: `Document declares language: "${htmlLang}".`,
      whyItMatters: 'Enables screen readers and translation tools to interpret content correctly.',
      recommendation: 'Maintain language attributes on localized pages.',
      priorityScore: 0,
    });
  }

  // 2. Visible Text Word Count
  // Clone to avoid altering original dom
  const cloned = cheerio.load(html);
  cloned('script, style, noscript, svg, nav, footer, header').remove();
  const visibleText = cloned('body').text().replace(/\s+/g, ' ').trim();
  const words = visibleText ? visibleText.split(/\s+/).filter(Boolean) : [];
  const wordCount = words.length;
  const paragraphCount = $('p').length;

  const isThinContent = wordCount < 150;
  if (isThinContent) {
    score -= 20;
    issues.push({
      category: 'content',
      severity: 'medium',
      issueCode: 'CONTENT_LOW_WORD_COUNT',
      title: 'Low Text Volume Detected (Thin Content Indicator)',
      url,
      evidence: `Visible body text contains approximately ${wordCount} words (threshold: 250+ words for general informational articles).`,
      whyItMatters:
        'Automated crawlers flag very short copy as potential "thin content". However, note the automated limitation: specialized pages like contact forms, login portals, media galleries, or interactive web applications naturally contain minimal paragraph copy and may not require expansion.',
      recommendation:
        'If this is an informational, product, or blog page, consider elaborating with in-depth explanations, FAQs, and key takeaway sections.',
      priorityScore: 55,
    });
  } else {
    issues.push({
      category: 'content',
      severity: 'passed',
      issueCode: 'CONTENT_SUBSTANTIAL_COPY',
      title: 'Substantial Text Content',
      url,
      evidence: `Found ${wordCount} words of readable copy across ${paragraphCount} paragraphs.`,
      whyItMatters: 'Provides search engines and users with sufficient topical context.',
      recommendation: 'Keep content well-researched and up-to-date.',
      priorityScore: 0,
    });
  }

  // 3. Navigation / Outbound Internal Linking Structure
  const internalOutboundLinks = $('a[href]').filter((_, el) => {
    const h = $(el).attr('href') || '';
    return h.startsWith('/') || h.startsWith('./') || !h.includes('://');
  }).length;

  if (internalOutboundLinks === 0 && wordCount > 100) {
    score -= 15;
    issues.push({
      category: 'content',
      severity: 'high',
      issueCode: 'CONTENT_NO_INTERNAL_LINKS',
      title: 'Page Has No Internal Links (Dead End / Low Interlinking)',
      url,
      evidence: 'No internal links to other pages on your site were found in the document.',
      whyItMatters:
        'Pages without internal links create dead ends for readers and prevent search engine bots from discovering adjacent related content.',
      recommendation:
        'Incorporate contextual internal links pointing to relevant services, articles, or conversion pages.',
      priorityScore: 78,
    });
  }

  return {
    score: Math.max(0, Math.min(100, Math.round(score))),
    issues,
    details: {
      wordCount,
      isThinContent,
      htmlLang,
      hasLanguageAttribute,
      internalOutboundLinks,
      externalOutboundLinks: $('a[href*="://"]').length,
      paragraphCount,
    },
  };
}

