import { Router } from 'express';
import { PublicToolsController } from '../controllers/publicToolsController.js';

const router = Router();

router.post('/seo', PublicToolsController.checkSeo);
router.post('/speed', PublicToolsController.checkSpeed);
router.post('/broken-links', PublicToolsController.checkBrokenLinks);
router.post('/ssl', PublicToolsController.checkSsl);
router.post('/mobile', PublicToolsController.checkMobile);
router.post('/security-headers', PublicToolsController.checkSecurityHeaders);
router.post('/battle', PublicToolsController.runCompetitorBattle);

export default router;

