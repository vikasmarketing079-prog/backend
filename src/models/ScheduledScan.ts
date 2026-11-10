import mongoose, { Document, Schema } from 'mongoose';

export interface IScheduledScan extends Document {
  website: mongoose.Types.ObjectId;
  user: mongoose.Types.ObjectId;
  frequency: 'daily' | 'weekly' | 'monthly';
  targetUrl: string;
  crawlDepth: number;
  maxPages: number;
  lastRunAt?: Date;
  nextRunAt: Date;
  enabled: boolean;
  notifyEmail?: string;
  createdAt: Date;
  updatedAt: Date;
}

const ScheduledScanSchema = new Schema<IScheduledScan>(
  {
    website: { type: Schema.Types.ObjectId, ref: 'Website', required: true, index: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    frequency: { type: String, enum: ['daily', 'weekly', 'monthly'], default: 'weekly' },
    targetUrl: { type: String, required: true },
    crawlDepth: { type: Number, default: 2 },
    maxPages: { type: Number, default: 50 },
    lastRunAt: { type: Date },
    nextRunAt: { type: Date, required: true, index: true },
    enabled: { type: Boolean, default: true },
    notifyEmail: { type: String },
  },
  { timestamps: true }
);

export const ScheduledScan = mongoose.model<IScheduledScan>('ScheduledScan', ScheduledScanSchema);

