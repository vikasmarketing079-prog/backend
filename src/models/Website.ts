import mongoose, { Document, Schema } from 'mongoose';

export interface IWebsite extends Document {
  user?: mongoose.Types.ObjectId;
  domain: string;
  name: string;
  url: string;
  defaultMaxPages: number;
  lastAuditId?: mongoose.Types.ObjectId;
  lastAuditDate?: Date;
  healthScore?: number;
  status: 'active' | 'archived';
  createdAt: Date;
  updatedAt: Date;
}

const WebsiteSchema = new Schema<IWebsite>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    domain: { type: String, required: true, trim: true, index: true },
    name: { type: String, required: true, trim: true },
    url: { type: String, required: true, trim: true },
    defaultMaxPages: { type: Number, default: 10 },
    lastAuditId: { type: Schema.Types.ObjectId, ref: 'Audit' },
    lastAuditDate: { type: Date },
    healthScore: { type: Number, min: 0, max: 100 },
    status: { type: String, enum: ['active', 'archived'], default: 'active' },
  },
  { timestamps: true }
);

export const Website = mongoose.model<IWebsite>('Website', WebsiteSchema);
