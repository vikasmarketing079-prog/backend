import mongoose, { Document, Schema } from 'mongoose';

export interface IPageAudit extends Document {
  audit: mongoose.Types.ObjectId;
  url: string;
  path: string;
  statusCode: number;
  responseTimeMs: number;
  pageSizeBytes: number;
  contentType: string;
  title?: string;
  metaDescription?: string;
  canonicalUrl?: string;
  h1Count: number;
  wordCount: number;
  internalLinksCount: number;
  externalLinksCount: number;
  imagesCount: number;
  missingAltCount: number;
  categoryScores: {
    seo: number;
    performance: number;
    mobile: number;
    security: number;
    technical: number;
    content: number;
  };
  performanceMetrics?: {
    fcp?: number;
    lcp?: number;
    cls?: number;
    tbt?: number;
    speedIndex?: number;
    ttfb?: number;
    totalRequests?: number;
  };
  mobileFindings?: {
    viewportConfigured: boolean;
    hasHorizontalOverflow: boolean;
    overflowDetails?: string[];
    testedBreakpoints?: number[];
  };
  securityHeaders?: {
    hasHsts: boolean;
    hasCsp: boolean;
    hasXFrame: boolean;
    hasXContentType: boolean;
    hasReferrerPolicy: boolean;
    hasPermissionsPolicy: boolean;
  };
  createdAt: Date;
}

const PageAuditSchema = new Schema<IPageAudit>(
  {
    audit: { type: Schema.Types.ObjectId, ref: 'Audit', required: true, index: true },
    url: { type: String, required: true },
    path: { type: String, required: true },
    statusCode: { type: Number, required: true },
    responseTimeMs: { type: Number, default: 0 },
    pageSizeBytes: { type: Number, default: 0 },
    contentType: { type: String, default: 'text/html' },
    title: { type: String },
    metaDescription: { type: String },
    canonicalUrl: { type: String },
    h1Count: { type: Number, default: 0 },
    wordCount: { type: Number, default: 0 },
    internalLinksCount: { type: Number, default: 0 },
    externalLinksCount: { type: Number, default: 0 },
    imagesCount: { type: Number, default: 0 },
    missingAltCount: { type: Number, default: 0 },
    categoryScores: {
      seo: { type: Number, default: 100 },
      performance: { type: Number, default: 100 },
      mobile: { type: Number, default: 100 },
      security: { type: Number, default: 100 },
      technical: { type: Number, default: 100 },
      content: { type: Number, default: 100 },
    },
    performanceMetrics: {
      fcp: { type: Number },
      lcp: { type: Number },
      cls: { type: Number },
      tbt: { type: Number },
      speedIndex: { type: Number },
      ttfb: { type: Number },
      totalRequests: { type: Number },
    },
    mobileFindings: {
      viewportConfigured: { type: Boolean, default: true },
      hasHorizontalOverflow: { type: Boolean, default: false },
      overflowDetails: [{ type: String }],
      testedBreakpoints: [{ type: Number }],
    },
    securityHeaders: {
      hasHsts: { type: Boolean, default: false },
      hasCsp: { type: Boolean, default: false },
      hasXFrame: { type: Boolean, default: false },
      hasXContentType: { type: Boolean, default: false },
      hasReferrerPolicy: { type: Boolean, default: false },
      hasPermissionsPolicy: { type: Boolean, default: false },
    },
  },
  { timestamps: true }
);

export const PageAudit = mongoose.model<IPageAudit>('PageAudit', PageAuditSchema);
