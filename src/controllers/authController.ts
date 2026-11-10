import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { User, IUser } from '../models/User.js';
import { ENV } from '../config/env.js';
import { AuthenticatedRequest } from '../middleware/authMiddleware.js';

function createToken(user: IUser): string {
  return jwt.sign(
    {
      id: user._id.toString(),
      email: user.email,
      role: user.role,
      plan: user.plan,
    },
    ENV.JWT_SECRET,
    { expiresIn: '7d' }
  );
}

export class AuthController {
  /**
   * Register a new user
   */
  public static async register(req: Request, res: Response): Promise<void> {
    try {
      const { name, email, password, companyName } = req.body;

      if (!name || !email || !password) {
        res.status(400).json({ success: false, error: 'Name, email, and password are required.' });
        return;
      }

      if (password.length < 6) {
        res.status(400).json({ success: false, error: 'Password must be at least 6 characters long.' });
        return;
      }

      const existing = await User.findOne({ email: email.toLowerCase().trim() });
      if (existing) {
        res.status(400).json({ success: false, error: 'An account with this email already exists.' });
        return;
      }

      const salt = await bcrypt.genSalt(10);
      const passwordHash = await bcrypt.hash(password, salt);

      const user = new User({
        name: name.trim(),
        email: email.toLowerCase().trim(),
        passwordHash,
        companyName: companyName?.trim() || '',
        plan: 'free',
        role: 'user',
      });

      await user.save();
      const token = createToken(user);

      res.status(201).json({
        success: true,
        data: {
          token,
          user: {
            id: user._id,
            name: user.name,
            email: user.email,
            role: user.role,
            plan: user.plan,
            companyName: user.companyName,
          },
        },
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  /**
   * User login
   */
  public static async login(req: Request, res: Response): Promise<void> {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        res.status(400).json({ success: false, error: 'Email and password are required.' });
        return;
      }

      const user = await User.findOne({ email: email.toLowerCase().trim() });
      if (!user) {
        res.status(401).json({ success: false, error: 'Invalid email or password.' });
        return;
      }

      const isMatch = await bcrypt.compare(password, user.passwordHash);
      if (!isMatch) {
        res.status(401).json({ success: false, error: 'Invalid email or password.' });
        return;
      }

      const token = createToken(user);

      res.json({
        success: true,
        data: {
          token,
          user: {
            id: user._id,
            name: user.name,
            email: user.email,
            role: user.role,
            plan: user.plan,
            companyName: user.companyName,
            whiteLabelSettings: user.whiteLabelSettings,
          },
        },
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  /**
   * Get current authenticated user details
   */
  public static async getMe(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, error: 'Not authenticated' });
        return;
      }

      const user = await User.findById(req.user.id).select('-passwordHash');
      if (!user) {
        res.status(404).json({ success: false, error: 'User not found' });
        return;
      }

      res.json({
        success: true,
        data: user,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  /**
   * Update profile and white-label settings
   */
  public static async updateProfile(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, error: 'Not authenticated' });
        return;
      }

      const { name, companyName, whiteLabelSettings, plan } = req.body;
      const user = await User.findById(req.user.id);

      if (!user) {
        res.status(404).json({ success: false, error: 'User not found' });
        return;
      }

      if (name) user.name = name.trim();
      if (companyName !== undefined) user.companyName = companyName.trim();
      if (plan && ['free', 'pro', 'agency'].includes(plan)) {
        user.plan = plan; // Allow tier switching for testing / demo
      }
      if (whiteLabelSettings) {
        user.whiteLabelSettings = {
          logoUrl: whiteLabelSettings.logoUrl || user.whiteLabelSettings?.logoUrl || '',
          brandColor: whiteLabelSettings.brandColor || user.whiteLabelSettings?.brandColor || '#0066FF',
          reportFooterText: whiteLabelSettings.reportFooterText || user.whiteLabelSettings?.reportFooterText || 'Generated by SiteAudit Pro',
        };
      }

      await user.save();

      res.json({
        success: true,
        data: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          plan: user.plan,
          companyName: user.companyName,
          whiteLabelSettings: user.whiteLabelSettings,
        },
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  /**
   * Forgot password request
   */
  public static async forgotPassword(req: Request, res: Response): Promise<void> {
    try {
      const { email } = req.body;
      if (!email) {
        res.status(400).json({ success: false, error: 'Email is required' });
        return;
      }

      // Check if user exists (don't disclose existence for security)
      const user = await User.findOne({ email: email.toLowerCase().trim() });
      if (user) {
        console.log(`[Auth Notice] Password reset requested for ${email}`);
      }

      res.json({
        success: true,
        message: 'If an account matches this email, instructions have been sent.',
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  /**
   * Seed demo user if no users exist in database
   */
  public static async ensureSeedUser(): Promise<void> {
    try {
      const count = await User.countDocuments();
      if (count === 0) {
        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash('Password123!', salt);

        const demoUser = new User({
          name: 'Demo Architect',
          email: 'demo@siteauditpro.com',
          passwordHash,
          role: 'agency',
          plan: 'agency',
          companyName: 'Apex Digital Agency',
          whiteLabelSettings: {
            brandColor: '#0066FF',
            reportFooterText: 'Apex Digital Audit Services',
          },
        });

        await demoUser.save();
        console.log('[Seed] Created default demo user: demo@siteauditpro.com (Password: Password123!)');
      }
    } catch (err: any) {
      console.warn('[Seed] Demo user check note:', err.message);
    }
  }
}

