import * as cheerio from 'cheerio';
import { IssueCategory, IssueSeverity } from '../models/AuditIssue.js';

export interface AnalyzerIssue {
  category: IssueCategory;
  severity: IssueSeverity;
  issueCode: string;
  title: string;
  url: string;
  evidence: string;
  whyItMatters: string;
  recommendation: string;
  priorityScore: number;
}

export interface SeoAnalysisResult {
  score: number;
  issues: AnalyzerIssue[];
  details: {
    title?: string;
    titleLength: number;
    metaDescription?: string;
    descriptionLength: number;
    canonicalUrl?: string;
    h1s: string[];
    headingsCount: { h1: number; h2: number; h3: number; h4: number; h5: number; h6: number };
    hasOgTags: boolean;
    hasTwitterTags: boolean;
    hasStructuredData: boolean;
    isNoindex: boolean;
    missingAltCount: number;
    totalImages: number;
  };
}

export function analyzeSeo(url: string, html: string, statusCode: number): SeoAnalysisResult {
  const $ = cheerio.load(html);
  const issues: AnalyzerIssue[] = [];
  let score = 100;

  // 1. Title Tag Check
  const titleTag = $('title').first().text().trim();
  const titleLength = titleTag.length;

  if (!titleTag) {
    score -= 25;
    issues.push({
      category: 'seo',
      severity: 'critical',
      issueCode: 'SEO_MISSING_TITLE',
      title: 'Missing Title Tag',
      url,
      evidence: 'No <title> tag was found in the HTML document.',
      whyItMatters:
        'The title tag is one of the most critical on-page SEO elements. Search engines use it to determine page relevance and display it as the clickable headline in search results.',
      recommendation:
        'Add a unique, descriptive <title> tag between 50 and 60 characters that includes your primary keyword.',
      priorityScore: 95,
    });
  } else if (titleLength < 30) {
    score -= 5;
    issues.push({
      category: 'seo',
      severity: 'low',
      issueCode: 'SEO_TITLE_TOO_SHORT',
      title: 'Title Tag Too Short',
      url,
      evidence: `Title tag length is ${titleLength} characters: "${titleTag}" (recommended: 30-60 characters).`,
      whyItMatters:
        'Short titles miss valuable opportunities to include relevant search terms that help your page rank for targeted queries.',
      recommendation:
        'Expand the title to between 50 and 60 characters with descriptive branding and primary keyword intent.',
      priorityScore: 40,
    });
  } else if (titleLength > 65) {
    score -= 10;
    issues.push({
      category: 'seo',
      severity: 'medium',
      issueCode: 'SEO_TITLE_TOO_LONG',
      title: 'Title Tag Exceeds Recommended Length',
      url,
      evidence: `Title tag length is ${titleLength} characters: "${titleTag}" (recommended max: 60 characters).`,
      whyItMatters:
        'Titles longer than 60 characters get truncated in Google search engine result pages with an ellipsis (...), lowering click-through rates.',
      recommendation:
        'Shorten the title tag to under 60 characters while keeping the most critical keywords near the beginning.',
      priorityScore: 60,
    });
  } else {
    issues.push({
      category: 'seo',
      severity: 'passed',
      issueCode: 'SEO_TITLE_OPTIMAL',
      title: 'Title Tag Present & Well Sized',
      url,
      evidence: `Title tag is ${titleLength} characters: "${titleTag}".`,
      whyItMatters: 'Page has a properly sized title tag that fits within standard search engine snippet display limits.',
      recommendation: 'Maintain this standard for future content updates.',
      priorityScore: 0,
    });
  }

  // 2. Meta Description Check
  const metaDescription = $('meta[name="description" i]').attr('content')?.trim() || '';
  const descLength = metaDescription.length;

  if (!metaDescription) {
    score -= 20;
    issues.push({
      category: 'seo',
      severity: 'high',
      issueCode: 'SEO_MISSING_META_DESCRIPTION',
      title: 'Missing Meta Description',
      url,
      evidence: 'No <meta name="description"> tag found on the page.',
      whyItMatters:
        'Without a meta description, search engines generate automated snippets from page copy that may be poorly formatted or uncompelling to prospective visitors.',
      recommendation:
        'Add a compelling meta description between 120 and 155 characters summarizing the page value proposition.',
      priorityScore: 85,
    });
  } else if (descLength < 70) {
    score -= 5;
    issues.push({
      category: 'seo',
      severity: 'low',
      issueCode: 'SEO_META_DESCRIPTION_TOO_SHORT',
      title: 'Meta Description Too Short',
      url,
      evidence: `Meta description is only ${descLength} characters: "${metaDescription}".`,
      whyItMatters:
        'Under-sized descriptions underutilize available snippet space in SERPs, resulting in lower search visibility and engagement.',
      recommendation:
        'Expand the meta description to 120-155 characters with a clear call-to-action.',
      priorityScore: 35,
    });
  } else if (descLength > 165) {
    score -= 8;
    issues.push({
      category: 'seo',
      severity: 'medium',
      issueCode: 'SEO_META_DESCRIPTION_TOO_LONG',
      title: 'Meta Description Exceeds Recommended Length',
      url,
      evidence: `Meta description is ${descLength} characters (recommended max: 155-160 characters).`,
      whyItMatters:
        'Descriptions over 160 characters are typically truncated by search engines, hiding important call-to-action text.',
      recommendation:
        'Trim the meta description to under 155 characters so the complete message is visible in search snippets.',
      priorityScore: 50,
    });
  } else {
    issues.push({
      category: 'seo',
      severity: 'passed',
      issueCode: 'SEO_META_DESCRIPTION_OPTIMAL',
      title: 'Meta Description Present & Well Sized',
      url,
      evidence: `Meta description length is ${descLength} characters.`,
      whyItMatters: 'Page provides search engines with a well-formatted description snippet.',
      recommendation: 'Ensure your description reflects current page offerings.',
      priorityScore: 0,
    });
  }

  // 3. H1 Headings Check
  const h1Elements = $('h1');
  const h1Count = h1Elements.length;
  const h1Texts: string[] = [];
  h1Elements.each((_, el) => {
    const text = $(el).text().trim();
    if (text) h1Texts.push(text);
  });

  if (h1Count === 0) {
    score -= 15;
    issues.push({
      category: 'seo',
      severity: 'high',
      issueCode: 'SEO_MISSING_H1',
      title: 'Missing H1 Heading Tag',
      url,
      evidence: 'No <h1> tag was found anywhere on the page.',
      whyItMatters:
        'The H1 tag serves as the primary top-level heading for both search engines and human readers. Missing H1 degrades content hierarchy understanding.',
      recommendation:
        'Add a single, clear <h1> tag representing the primary subject matter of this page.',
      priorityScore: 80,
    });
  } else if (h1Count > 1) {
    score -= 10;
    issues.push({
      category: 'seo',
      severity: 'medium',
      issueCode: 'SEO_MULTIPLE_H1',
      title: 'Multiple H1 Heading Tags Found',
      url,
      evidence: `Found ${h1Count} separate <h1> tags on the page: ${h1Texts.map((t) => `"${t}"`).slice(0, 3).join(', ')}.`,
      whyItMatters:
        'Multiple H1 headings can dilute topical focus and confuse accessibility screen readers regarding the main topic of the document.',
      recommendation:
        'Reserve <h1> for the singular main title of the page, and convert secondary headings to <h2> and <h3> tags.',
      priorityScore: 65,
    });
  } else {
    issues.push({
      category: 'seo',
      severity: 'passed',
      issueCode: 'SEO_H1_VALID',
      title: 'Singular H1 Tag Configured',
      url,
      evidence: `Found exactly 1 H1 tag: "${h1Texts[0] || ''}".`,
      whyItMatters: 'The document maintains a clear primary topic structure.',
      recommendation: 'Keep one H1 per page for optimal hierarchy.',
      priorityScore: 0,
    });
  }

  // 4. Heading Hierarchy Check
  const headingsCount = {
    h1: h1Count,
    h2: $('h2').length,
    h3: $('h3').length,
    h4: $('h4').length,
    h5: $('h5').length,
    h6: $('h6').length,
  };

  if (headingsCount.h3 > 0 && headingsCount.h2 === 0) {
    score -= 5;
    issues.push({
      category: 'seo',
      severity: 'low',
      issueCode: 'SEO_SKIPPED_HEADING_LEVEL',
      title: 'Skipped Heading Hierarchy Level',
      url,
      evidence: `Found ${headingsCount.h3} <h3> elements without any <h2> elements present.`,
      whyItMatters:
        'Skipping heading levels (e.g. jumping from H1 directly to H3) violates accessibility best practices (WCAG) and confuses search engine document parsing.',
      recommendation:
        'Structure content hierarchically by nesting subheadings sequentially (H1 -> H2 -> H3).',
      priorityScore: 30,
    });
  }

  // 5. Canonical URL Check
  const canonicalTag = $('link[rel="canonical" i]').attr('href')?.trim();
  if (!canonicalTag) {
    score -= 10;
    issues.push({
      category: 'seo',
      severity: 'medium',
      issueCode: 'SEO_MISSING_CANONICAL',
      title: 'Missing Canonical Tag',
      url,
      evidence: 'No <link rel="canonical"> tag was specified on this page.',
      whyItMatters:
        'Canonical tags prevent duplicate content penalties by explicitly telling search engines which version of a URL is the authoritative master copy.',
      recommendation:
        `Add a self-referencing canonical tag: <link rel="canonical" href="${url}" />.`,
      priorityScore: 70,
    });
  } else {
    issues.push({
      category: 'seo',
      severity: 'passed',
      issueCode: 'SEO_CANONICAL_PRESENT',
      title: 'Canonical Tag Configured',
      url,
      evidence: `Canonical URL declared: "${canonicalTag}".`,
      whyItMatters: 'Helps search engines avoid duplicate content indexing.',
      recommendation: 'Ensure the canonical points to the absolute, HTTPS version.',
      priorityScore: 0,
    });
  }

  // 6. Image Alt Attributes Check
  const images = $('img');
  const totalImages = images.length;
  let missingAltCount = 0;
  const missingAltSources: string[] = [];

  images.each((_, el) => {
    const alt = $(el).attr('alt');
    const src = $(el).attr('src') || $(el).attr('data-src') || '';
    if (alt === undefined || alt === null || alt.trim() === '') {
      missingAltCount++;
      if (src && missingAltSources.length < 5) {
        missingAltSources.push(src);
      }
    }
  });

  if (missingAltCount > 0) {
    const deduction = Math.min(15, Math.ceil((missingAltCount / (totalImages || 1)) * 15));
    score -= deduction;
    issues.push({
      category: 'seo',
      severity: missingAltCount > 3 ? 'high' : 'medium',
      issueCode: 'SEO_MISSING_IMAGE_ALT',
      title: `${missingAltCount} Image${missingAltCount > 1 ? 's' : ''} Missing Alt Attributes`,
      url,
      evidence: `${missingAltCount} out of ${totalImages} images do not have an alt attribute. Examples: ${missingAltSources.join(', ')}.`,
      whyItMatters:
        'Alt attributes allow search engine crawlers to understand image contents and index them in Google Images. They are also mandatory for visually impaired visitors using screen readers.',
      recommendation:
        'Add descriptive, concise alt attributes to every informative image describing its visual content.',
      priorityScore: 75,
    });
  } else if (totalImages > 0) {
    issues.push({
      category: 'seo',
      severity: 'passed',
      issueCode: 'SEO_IMAGE_ALT_ALL_PRESENT',
      title: 'All Images Contain Alt Text',
      url,
      evidence: `All ${totalImages} images on this page contain alt attributes.`,
      whyItMatters: 'Ensures accessibility compliance and maximum image search visibility.',
      recommendation: 'Continue providing descriptive alt text for new images.',
      priorityScore: 0,
    });
  }

  // 7. Open Graph (OG) Tags Check
  const ogTitle = $('meta[property="og:title" i]').attr('content');
  const ogDescription = $('meta[property="og:description" i]').attr('content');
  const ogImage = $('meta[property="og:image" i]').attr('content');
  const hasOgTags = Boolean(ogTitle || ogDescription || ogImage);

  if (!ogTitle || !ogImage) {
    score -= 5;
    issues.push({
      category: 'seo',
      severity: 'low',
      issueCode: 'SEO_INCOMPLETE_OPEN_GRAPH',
      title: 'Incomplete Open Graph Social Metadata',
      url,
      evidence: `Missing ${!ogTitle ? 'og:title ' : ''}${!ogImage ? 'og:image ' : ''}social meta tags.`,
      whyItMatters:
        'Open Graph meta tags control how your content renders when shared across Facebook, LinkedIn, WhatsApp, and Slack. Missing tags lead to broken preview cards.',
      recommendation:
        'Add og:title, og:description, and high-resolution og:image (1200x630px) tags to the page <head>.',
      priorityScore: 45,
    });
  }

  // 8. Twitter Card Tags Check
  const twitterCard = $('meta[name="twitter:card" i]').attr('content');
  const hasTwitterTags = Boolean(twitterCard);
  if (!twitterCard) {
    score -= 4;
    issues.push({
      category: 'seo',
      severity: 'low',
      issueCode: 'SEO_MISSING_TWITTER_CARD',
      title: 'Missing Twitter Card Tags',
      url,
      evidence: 'No <meta name="twitter:card"> tag detected.',
      whyItMatters:
        'Twitter Cards generate rich media previews when users tweet links to your website.',
      recommendation:
        'Include <meta name="twitter:card" content="summary_large_image"> and related Twitter metadata.',
      priorityScore: 35,
    });
  }

  // 9. Structured Data (Schema.org / JSON-LD) Check
  let hasStructuredData = false;
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const content = $(el).html()?.trim();
      if (content && JSON.parse(content)) {
        hasStructuredData = true;
      }
    } catch {
      // invalid json
    }
  });

  if (!hasStructuredData) {
    score -= 8;
    issues.push({
      category: 'seo',
      severity: 'medium',
      issueCode: 'SEO_MISSING_STRUCTURED_DATA',
      title: 'No Structured Data (Schema.org) Detected',
      url,
      evidence: 'No valid application/ld+json schema markup found on the page.',
      whyItMatters:
        'Structured data enables search engines to display rich snippets (ratings, FAQs, product pricing, organization details) in search results, increasing CTR.',
      recommendation:
        'Implement Schema.org JSON-LD markup appropriate for this page (e.g., Organization, Article, WebSite, FAQPage, Product).',
      priorityScore: 60,
    });
  } else {
    issues.push({
      category: 'seo',
      severity: 'passed',
      issueCode: 'SEO_STRUCTURED_DATA_DETECTED',
      title: 'Structured Data (Schema.org) Detected',
      url,
      evidence: 'Found valid JSON-LD structured data on page.',
      whyItMatters: 'Allows rich snippet enhancements in search results.',
      recommendation: 'Validate your schema using Google Rich Results Test regularly.',
      priorityScore: 0,
    });
  }

  // 10. Robots Directives (noindex check)
  const robotsMeta = $('meta[name="robots" i]').attr('content')?.toLowerCase() || '';
  const isNoindex = robotsMeta.includes('noindex');

  if (isNoindex) {
    issues.push({
      category: 'seo',
      severity: 'high',
      issueCode: 'SEO_NOINDEX_DIRECTIVE',
      title: 'Page Marked as "noindex"',
      url,
      evidence: `Found <meta name="robots" content="${robotsMeta}"> instructing search engines not to index this page.`,
      whyItMatters:
        'A "noindex" tag instructs search engines to exclude this page completely from organic search result rankings.',
      recommendation:
        'If this page should be discoverable via search engines, remove the "noindex" directive from your meta robots tag.',
      priorityScore: 90,
    });
  }

  return {
    score: Math.max(0, Math.min(100, Math.round(score))),
    issues,
    details: {
      title: titleTag,
      titleLength,
      metaDescription,
      descriptionLength: descLength,
      canonicalUrl: canonicalTag,
      h1s: h1Texts,
      headingsCount,
      hasOgTags,
      hasTwitterTags,
      hasStructuredData,
      isNoindex,
      missingAltCount,
      totalImages,
    },
  };
}
