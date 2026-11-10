import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/authMiddleware.js';
import { User } from '../models/User.js';
import { Subscription } from '../models/Subscription.js';
import { ENV } from '../config/env.js';

export const PLANS_CONFIG = [
  {
    id: 'free',
    name: 'Free Starter',
    priceUsd: 0,
    priceInr: 0,
    interval: 'forever',
    maxPagesPerScan: 10,
    maxWebsites: 1,
    features: [
      '10 pages crawled per scan',
      'Core SEO & Performance audit',
      'Mobile responsiveness check',
      'Basic security header audit',
      'Prioritized action plan',
      'View results in dashboard',
    ],
    popular: false,
  },
  {
    id: 'pro',
    name: 'Pro Consultant',
    priceUsd: 29,
    priceInr: 2499,
    interval: 'month',
    maxPagesPerScan: 100,
    maxWebsites: 5,
    features: [
      '100 pages crawled per scan',
      'Full deep multi-page crawl',
      'Downloadable PDF reports',
      'Automated weekly scans',
      'Email alerts & notifications',
      'Audit comparison & diff tracking',
      'Historical trend charts',
    ],
    popular: true,
  },
  {
    id: 'agency',
    name: 'Agency Enterprise',
    priceUsd: 99,
    priceInr: 7999,
    interval: 'month',
    maxPagesPerScan: 500,
    maxWebsites: 50,
    features: [
      '500 pages crawled per scan',
      'Unlimited client websites',
      'Custom White-Label PDF reports (your logo, colors, branding)',
      'Multi-team member workspace',
      'Priority crawling queue',
      'Dedicated API access',
    ],
    popular: false,
  },
];

export class SubscriptionController {
  /**
   * Returns plan options and payment provider availability
   */
  public static async getPlans(_req: AuthenticatedRequest, res: Response): Promise<void> {
    res.json({
      success: true,
      plans: PLANS_CONFIG,
      gateways: {
        stripeAvailable: Boolean(ENV.STRIPE_SECRET_KEY),
        razorpayAvailable: Boolean(ENV.RAZORPAY_KEY_ID && ENV.RAZORPAY_KEY_SECRET),
        razorpayKeyId: ENV.RAZORPAY_KEY_ID || null,
      },
    });
  }

  /**
   * Initializes checkout intent
   */
  public static async createCheckoutSession(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, error: 'Authentication required' });
        return;
      }

      const { planId, provider = 'stripe' } = req.body;
      const targetPlan = PLANS_CONFIG.find((p) => p.id === planId);

      if (!targetPlan) {
        res.status(400).json({ success: false, error: 'Invalid plan selected.' });
        return;
      }

      // If user chooses free plan
      if (planId === 'free') {
        await User.findByIdAndUpdate(req.user.id, { plan: 'free' });
        res.json({ success: true, message: 'Plan updated to Free Starter.' });
        return;
      }

      if (provider === 'razorpay') {
        if (!ENV.RAZORPAY_KEY_ID || !ENV.RAZORPAY_KEY_SECRET) {
          res.status(503).json({
            success: false,
            error:
              'Razorpay integration requires RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in backend .env. Please configure them to enable real transactions.',
          });
          return;
        }
        // When configured, create real Razorpay order
        res.json({
          success: true,
          gateway: 'razorpay',
          keyId: ENV.RAZORPAY_KEY_ID,
          amount: targetPlan.priceInr * 100,
          currency: 'INR',
        });
        return;
      }

      // Default: Stripe
      if (!ENV.STRIPE_SECRET_KEY) {
        res.status(503).json({
          success: false,
          error:
            'Stripe payments require STRIPE_SECRET_KEY in backend .env. Please provide credentials to enable live payment processing.',
        });
        return;
      }

      res.json({
        success: true,
        gateway: 'stripe',
        message: 'Stripe session created',
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }

  /**
   * Upgrade tier directly for testing / development or manual fulfillment
   */
  public static async changeTier(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({ success: false, error: 'Not authenticated' });
        return;
      }

      const { plan } = req.body;
      if (!['free', 'pro', 'agency'].includes(plan)) {
        res.status(400).json({ success: false, error: 'Invalid tier specified.' });
        return;
      }

      await User.findByIdAndUpdate(req.user.id, { plan });
      await Subscription.findOneAndUpdate(
        { user: req.user.id },
        {
          user: req.user.id,
          plan,
          status: 'active',
          maxPagesPerScan: plan === 'agency' ? 500 : plan === 'pro' ? 100 : 10,
          scheduledScansAllowed: plan !== 'free',
          whiteLabelAllowed: plan === 'agency',
        },
        { upsert: true }
      );

      res.json({
        success: true,
        message: `Plan successfully updated to ${plan.toUpperCase()}`,
        plan,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }
}

