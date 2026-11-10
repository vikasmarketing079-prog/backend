import { Response } from 'express';
import { Website } from '../models/Website.js';
import { Audit } from '../models/Audit.js';
import { AuthenticatedRequest } from '../middleware/authMiddleware.js';
import { normalizeUrl } from '../crawler/urlNormalizer.js';
import { URL } from 'url';

export class WebsiteController {
  /**
   * List websites for current user
   */
  public static async list(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, error: 'Not authenticated' });
        return;
      }

      const websites = await Website.find({ user: req.user.id }).sort({ updatedAt: -1 });

      res.json({
        success: true,
        count: websites.length,
        data: websites,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  /**
   * Add a new website to track
   */
  public static async create(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, error: 'Not authenticated' });
        return;
      }

      const { url, name, defaultMaxPages } = req.body;
      if (!url) {
        res.status(400).json({ success: false, error: 'Website URL is required.' });
        return;
      }

      const normalized = normalizeUrl(url);
      if (!normalized) {
        res.status(400).json({ success: false, error: 'Invalid URL provided.' });
        return;
      }

      const domain = new URL(normalized).hostname;
      const websiteName = name?.trim() || domain;

      const website = new Website({
        user: req.user.id,
        domain,
        name: websiteName,
        url: normalized,
        defaultMaxPages: defaultMaxPages || (req.user.plan === 'agency' ? 200 : req.user.plan === 'pro' ? 100 : 10),
      });

      await website.save();

      res.status(201).json({
        success: true,
        data: website,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  /**
   * Get single website with historical audits
   */
  public static async getById(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const website = await Website.findById(id);

      if (!website) {
        res.status(404).json({ success: false, error: 'Website not found' });
        return;
      }

      const audits = await Audit.find({
        $or: [{ website: website._id }, { targetUrl: website.url }],
      })
        .select('healthScore categoryScores issuesSummary pagesScanned createdAt status')
        .sort({ createdAt: -1 })
        .limit(20);

      res.json({
        success: true,
        data: {
          website,
          auditHistory: audits,
        },
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  /**
   * Delete website
   */
  public static async delete(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      await Website.findByIdAndDelete(id);

      res.json({
        success: true,
        message: 'Website deleted successfully',
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }
}
