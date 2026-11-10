import { IAuditCategoryScores, IAuditIssuesSummary } from '../models/Audit.js';
import { IAuditIssue } from '../models/AuditIssue.js';

export interface CalculatedHealthScore {
  overallHealthScore: number;
  categoryScores: IAuditCategoryScores;
  issuesSummary: IAuditIssuesSummary;
}

export const CATEGORY_WEIGHTS = {
  seo: 0.25,
  performance: 0.25,
  mobile: 0.20,
  security: 0.15,
  technical: 0.10,
  content: 0.05,
};

/**
 * Calculates overall weighted health score from actual category scores
 */
export function calculateWebsiteHealthScore(
  categoryScores: IAuditCategoryScores,
  issues: Array<Partial<IAuditIssue>>
): CalculatedHealthScore {
  // Compute weighted composite score
  const overall =
    categoryScores.seo * CATEGORY_WEIGHTS.seo +
    categoryScores.performance * CATEGORY_WEIGHTS.performance +
    categoryScores.mobile * CATEGORY_WEIGHTS.mobile +
    categoryScores.security * CATEGORY_WEIGHTS.security +
    categoryScores.technical * CATEGORY_WEIGHTS.technical +
    categoryScores.content * CATEGORY_WEIGHTS.content;

  const boundedOverall = Math.max(0, Math.min(100, Math.round(overall)));

  // Aggregate issues by severity
  const issuesSummary: IAuditIssuesSummary = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    passed: 0,
    total: 0,
  };

  for (const issue of issues) {
    if (!issue.severity) continue;
    if (issue.severity === 'critical') issuesSummary.critical++;
    else if (issue.severity === 'high') issuesSummary.high++;
    else if (issue.severity === 'medium') issuesSummary.medium++;
    else if (issue.severity === 'low') issuesSummary.low++;
    else if (issue.severity === 'passed') issuesSummary.passed++;
  }

  issuesSummary.total =
    issuesSummary.critical + issuesSummary.high + issuesSummary.medium + issuesSummary.low;

  return {
    overallHealthScore: boundedOverall,
    categoryScores: {
      seo: Math.round(categoryScores.seo),
      performance: Math.round(categoryScores.performance),
      mobile: Math.round(categoryScores.mobile),
      security: Math.round(categoryScores.security),
      technical: Math.round(categoryScores.technical),
      content: Math.round(categoryScores.content),
    },
    issuesSummary,
  };
}
