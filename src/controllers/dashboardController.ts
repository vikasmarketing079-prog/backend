import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/authMiddleware.js';
import { Website } from '../models/Website.js';
import { Audit } from '../models/Audit.js';

export class DashboardController {
  public static async getOverview(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      const query: any = userId ? { user: userId } : {};

      const websitesCount = userId ? await Website.countDocuments({ user: userId }) : 0;
      const recentAudits = await Audit.find(query).sort({ createdAt: -1 }).limit(10);
      const totalAuditsCount = await Audit.countDocuments(query);

      // Calculate averages from completed audits
      const completedAudits = await Audit.find({ ...query, status: 'completed' })
        .select('healthScore categoryScores issuesSummary createdAt')
        .sort({ createdAt: -1 })
        .limit(20);

      let totalHealth = 0;
      let totalCritical = 0;
      let totalHigh = 0;

      for (const a of completedAudits) {
        totalHealth += a.healthScore || 0;
        totalCritical += a.issuesSummary?.critical || 0;
        totalHigh += a.issuesSummary?.high || 0;
      }

      const avgHealth = completedAudits.length > 0 ? Math.round(totalHealth / completedAudits.length) : 0;

      // Health score trend over recent audits
      const healthTrend = completedAudits.slice(0, 7).reverse().map((a) => ({
        date: new Date(a.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        healthScore: a.healthScore,
        seo: a.categoryScores?.seo,
        performance: a.categoryScores?.performance,
        security: a.categoryScores?.security,
      }));

      res.json({
        success: true,
        data: {
          websitesCount,
          totalAuditsCount,
          averageHealthScore: avgHealth,
          totalCriticalIssues: totalCritical,
          totalHighIssues: totalHigh,
          recentAudits,
          healthTrend,
        },
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }
}

