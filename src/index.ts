import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { ENV } from './config/env.js';
import { connectDB } from './config/database.js';
import auditRoutes from './routes/auditRoutes.js';
import publicToolsRoutes from './routes/publicToolsRoutes.js';
import authRoutes from './routes/authRoutes.js';
import websiteRoutes from './routes/websiteRoutes.js';
import dashboardRoutes from './routes/dashboardRoutes.js';
import subscriptionRoutes from './routes/subscriptionRoutes.js';
import { AuthController } from './controllers/authController.js';
import { ScheduledScanWorker } from './jobs/scheduledScanWorker.js';

const app = express();

// Security headers
app.disable('x-powered-by');

// CORS configuration
app.use(
  cors({
    origin: [ENV.FRONTEND_URL, 'http://localhost:5173', 'http://127.0.0.1:5173'],
    credentials: true,
  })
);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Health Check
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'SiteAudit Pro Core Engine API',
  });
});

// API Routes
app.use('/api/audits', auditRoutes);
app.use('/api/tools', publicToolsRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/websites', websiteRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/subscriptions', subscriptionRoutes);

// Global Error Handler
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[API Error Trace]', err);
  res.status(err.status || 500).json({
    success: false,
    error: err.message || 'An unexpected internal server error occurred.',
  });
});

// Start Server
async function startServer(): Promise<void> {
  await connectDB();
  await AuthController.ensureSeedUser();
  ScheduledScanWorker.start();

  app.listen(ENV.PORT, () => {
    console.log(`====================================================`);
    console.log(`🚀 SiteAudit Pro Engine Server running on port ${ENV.PORT}`);
    console.log(`🌐 API Endpoint: http://localhost:${ENV.PORT}/api`);
    console.log(`📡 MongoDB: Connected to ${ENV.MONGODB_URI}`);
    console.log(`====================================================`);
  });
}

startServer().catch((err) => {
  console.error('Fatal initialization error:', err);
  process.exit(1);
});

