import dotenv from 'dotenv';
dotenv.config();

export const ENV = {
  PORT: parseInt(process.env.PORT || '5000', 10),
  NODE_ENV: process.env.NODE_ENV || 'development',
  MONGODB_URI: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/siteaudit_pro',
  JWT_SECRET: process.env.JWT_SECRET || 'siteaudit-pro-super-secure-secret-key-2025',
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '7d',
  FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:5173',
  GOOGLE_PAGESPEED_API_KEY: process.env.GOOGLE_PAGESPEED_API_KEY || '',
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY || '',
  RAZORPAY_KEY_ID: process.env.RAZORPAY_KEY_ID || '',
  RAZORPAY_KEY_SECRET: process.env.RAZORPAY_KEY_SECRET || '',
  SMTP_HOST: process.env.SMTP_HOST || '',
  SMTP_PORT: parseInt(process.env.SMTP_PORT || '587', 10),
  SMTP_USER: process.env.SMTP_USER || '',
  SMTP_PASS: process.env.SMTP_PASS || '',
  DEFAULT_FREE_CRAWL_LIMIT: parseInt(process.env.DEFAULT_FREE_CRAWL_LIMIT || '10', 10),
  DEFAULT_PRO_CRAWL_LIMIT: parseInt(process.env.DEFAULT_PRO_CRAWL_LIMIT || '100', 10),
  DEFAULT_AGENCY_CRAWL_LIMIT: parseInt(process.env.DEFAULT_AGENCY_CRAWL_LIMIT || '500', 10),
};
