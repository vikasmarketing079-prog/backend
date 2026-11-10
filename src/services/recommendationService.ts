import { IAuditIssue } from '../models/AuditIssue.js';

export interface PrioritizedRecommendation {
  priority: number;
  issueCode: string;
  category: string;
  severity: string;
  title: string;
  count: number;
  whyItMatters: string;
  recommendation: string;
  affectedUrls: string[];
}

/**
 * Groups and ranks detected issues into an actionable prioritized plan
 */
export function buildPrioritizedActionPlan(issues: IAuditIssue[]): PrioritizedRecommendation[] {
  // Filter out passed tests
  const failingIssues = issues.filter((i) => i.severity !== 'passed');

  // Group by issueCode
  const groups = new Map<string, { issue: IAuditIssue; urls: Set<string>; maxPriorityScore: number }>();

  for (const issue of failingIssues) {
    const existing = groups.get(issue.issueCode);
    if (!existing) {
      groups.set(issue.issueCode, {
        issue,
        urls: new Set([issue.url]),
        maxPriorityScore: issue.priorityScore || 50,
      });
    } else {
      existing.urls.add(issue.url);
      existing.maxPriorityScore = Math.max(existing.maxPriorityScore, issue.priorityScore || 50);
    }
  }

  // Convert to sorted array by priorityScore (highest first)
  const sorted = Array.from(groups.values()).sort((a, b) => {
    // Severity weight
    const severityWeight: Record<string, number> = { critical: 400, high: 300, medium: 200, low: 100 };
    const aWeight = (severityWeight[a.issue.severity] || 0) + a.maxPriorityScore + Math.min(20, a.urls.size * 2);
    const bWeight = (severityWeight[b.issue.severity] || 0) + b.maxPriorityScore + Math.min(20, b.urls.size * 2);
    return bWeight - aWeight;
  });

  return sorted.map((item, index) => ({
    priority: index + 1,
    issueCode: item.issue.issueCode,
    category: item.issue.category,
    severity: item.issue.severity,
    title: item.urls.size > 1 ? `${item.issue.title} (Affects ${item.urls.size} pages)` : item.issue.title,
    count: item.urls.size,
    whyItMatters: item.issue.whyItMatters,
    recommendation: item.issue.recommendation,
    affectedUrls: Array.from(item.urls),
  }));
}

