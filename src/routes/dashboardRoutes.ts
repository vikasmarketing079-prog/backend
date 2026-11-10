import { Router } from 'express';
import { DashboardController } from '../controllers/dashboardController.js';
import { optionalAuth } from '../middleware/authMiddleware.js';

const router = Router();

router.get('/overview', optionalAuth, DashboardController.getOverview);

export default router;

