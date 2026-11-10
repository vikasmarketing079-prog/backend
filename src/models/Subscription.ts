import mongoose, { Document, Schema } from 'mongoose';

export interface ISubscription extends Document {
  user: mongoose.Types.ObjectId;
  plan: 'free' | 'pro' | 'agency';
  status: 'active' | 'canceled' | 'past_due' | 'trialing';
  provider: 'stripe' | 'razorpay' | 'manual';
  subscriptionId?: string;
  customerId?: string;
  maxPagesPerScan: number;
  scheduledScansAllowed: boolean;
  whiteLabelAllowed: boolean;
  expiresAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const SubscriptionSchema = new Schema<ISubscription>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    plan: { type: String, enum: ['free', 'pro', 'agency'], default: 'free' },
    status: { type: String, enum: ['active', 'canceled', 'past_due', 'trialing'], default: 'active' },
    provider: { type: String, enum: ['stripe', 'razorpay', 'manual'], default: 'manual' },
    subscriptionId: { type: String },
    customerId: { type: String },
    maxPagesPerScan: { type: Number, default: 10 },
    scheduledScansAllowed: { type: Boolean, default: false },
    whiteLabelAllowed: { type: Boolean, default: false },
    expiresAt: { type: Date },
  },
  { timestamps: true }
);

export const Subscription = mongoose.model<ISubscription>('Subscription', SubscriptionSchema);
