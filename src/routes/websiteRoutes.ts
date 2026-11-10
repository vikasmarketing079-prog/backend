import { Router } from 'express';
import { WebsiteController } from '../controllers/websiteController.js';
import { requireAuth } from '../middleware/authMiddleware.js';

const router = Router();

router.use(requireAuth);

router.get('/', WebsiteController.list);
router.post('/', WebsiteController.create);
router.get('/:id', WebsiteController.getById);
router.delete('/:id', WebsiteController.delete);

export default router;

