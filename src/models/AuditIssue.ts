import mongoose, { Document, Schema } from 'mongoose';

export type IssueCategory =
  | 'seo'
  | 'performance'
  | 'mobile'
  | 'security'
  | 'broken_link'
  | 'content'
  | 'technical';

export type IssueSeverity = 'critical' | 'high' | 'medium' | 'low' | 'passed';

export interface IAuditIssue extends Document {
  audit: mongoose.Types.ObjectId;
  pageAudit?: mongoose.Types.ObjectId;
  category: IssueCategory;
  severity: IssueSeverity;
  issueCode: string;
  title: string;
  url: string;
  evidence: string;
  whyItMatters: string;
  recommendation: string;
  priorityScore: number;
  resolved: boolean;
  createdAt: Date;
}

const AuditIssueSchema = new Schema<IAuditIssue>(
  {
    audit: { type: Schema.Types.ObjectId, ref: 'Audit', required: true, index: true },
    pageAudit: { type: Schema.Types.ObjectId, ref: 'PageAudit', index: true },
    category: {
      type: String,
      enum: ['seo', 'performance', 'mobile', 'security', 'broken_link', 'content', 'technical'],
      required: true,
      index: true,
    },
    severity: {
      type: String,
      enum: ['critical', 'high', 'medium', 'low', 'passed'],
      required: true,
      index: true,
    },
    issueCode: { type: String, required: true },
    title: { type: String, required: true },
    url: { type: String, required: true },
    evidence: { type: String, required: true },
    whyItMatters: { type: String, required: true },
    recommendation: { type: String, required: true },
    priorityScore: { type: Number, default: 0 },
    resolved: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export const AuditIssue = mongoose.model<IAuditIssue>('AuditIssue', AuditIssueSchema);
