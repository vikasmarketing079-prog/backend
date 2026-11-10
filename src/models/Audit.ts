import mongoose, { Document, Schema } from 'mongoose';

export interface IAuditCategoryScores {
  seo: number;
  performance: number;
  mobile: number;
  security: number;
  technical: number;
  content: number;
}

export interface IAuditIssuesSummary {
  critical: number;
  high: number;
  medium: number;
  low: number;
  passed: number;
  total: number;
}

export interface IAudit extends Document {
  website?: mongoose.Types.ObjectId;
  user?: mongoose.Types.ObjectId;
  guestSessionId?: string;
  targetUrl: string;
  crawlDepth: number;
  maxPages: number;
  status: 'pending' | 'crawling' | 'analyzing' | 'completed' | 'failed';
  currentStepMessage?: string;
  progressPercent: number;
  healthScore: number;
  categoryScores: IAuditCategoryScores;
  issuesSummary: IAuditIssuesSummary;
  pagesDiscovered: number;
  pagesScanned: number;
  crawlDurationMs: number;
  startedAt: Date;
  completedAt?: Date;
  errorMessage?: string;
  pdfReportPath?: string;
  isDemo?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const AuditSchema = new Schema<IAudit>(
  {
    website: { type: Schema.Types.ObjectId, ref: 'Website', index: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    guestSessionId: { type: String, index: true },
    targetUrl: { type: String, required: true, trim: true },
    crawlDepth: { type: Number, default: 2 },
    maxPages: { type: Number, default: 10 },
    status: {
      type: String,
      enum: ['pending', 'crawling', 'analyzing', 'completed', 'failed'],
      default: 'pending',
      index: true,
    },
    currentStepMessage: { type: String, default: 'Initializing scan engine...' },
    progressPercent: { type: Number, default: 0 },
    healthScore: { type: Number, default: 0, min: 0, max: 100 },
    categoryScores: {
      seo: { type: Number, default: 0, min: 0, max: 100 },
      performance: { type: Number, default: 0, min: 0, max: 100 },
      mobile: { type: Number, default: 0, min: 0, max: 100 },
      security: { type: Number, default: 0, min: 0, max: 100 },
      technical: { type: Number, default: 0, min: 0, max: 100 },
      content: { type: Number, default: 0, min: 0, max: 100 },
    },
    issuesSummary: {
      critical: { type: Number, default: 0 },
      high: { type: Number, default: 0 },
      medium: { type: Number, default: 0 },
      low: { type: Number, default: 0 },
      passed: { type: Number, default: 0 },
      total: { type: Number, default: 0 },
    },
    pagesDiscovered: { type: Number, default: 0 },
    pagesScanned: { type: Number, default: 0 },
    crawlDurationMs: { type: Number, default: 0 },
    startedAt: { type: Date, default: Date.now },
    completedAt: { type: Date },
    errorMessage: { type: String },
    pdfReportPath: { type: String },
    isDemo: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export const Audit = mongoose.model<IAudit>('Audit', AuditSchema);
