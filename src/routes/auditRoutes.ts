import { Router } from 'express';
import { AuditController } from '../controllers/auditController.js';
import { optionalAuth, requireAuth } from '../middleware/authMiddleware.js';

const router = Router();

// Demo endpoint (labeled demonstration report)
router.get('/demo', AuditController.getDemo);

// Audit execution
router.post('/start', optionalAuth, AuditController.start);
router.get('/:id', AuditController.getById);
router.get('/:id/progress', AuditController.getProgress);
router.get('/:id/issues', AuditController.getIssues);
router.get('/:id/pages', AuditController.getPages);
router.get('/:id/pdf', AuditController.downloadPdf);
router.post('/:id/rescan', optionalAuth, AuditController.rescan);
router.get('/:id/compare/:previousAuditId', optionalAuth, AuditController.compare);
router.post('/reports/:id/email', AuditController.emailReport);

export default router;
