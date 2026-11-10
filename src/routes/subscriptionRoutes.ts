import { Router } from 'express';
import { SubscriptionController } from '../controllers/subscriptionController.js';
import { optionalAuth, requireAuth } from '../middleware/authMiddleware.js';

const router = Router();

router.get('/plans', optionalAuth, SubscriptionController.getPlans);
router.post('/checkout', requireAuth, SubscriptionController.createCheckoutSession);
router.post('/tier', requireAuth, SubscriptionController.changeTier);

export default router;

