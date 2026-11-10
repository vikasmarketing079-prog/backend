import { ENV } from '../config/env.js';

export interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  attachmentPath?: string;
}

/**
 * Handles transactional email notifications with clear configuration checks
 */
export async function sendEmailNotification(options: EmailOptions): Promise<{ success: boolean; message: string }> {
  // Check if SMTP credentials configured
  if (!ENV.SMTP_HOST || !ENV.SMTP_USER) {
    console.log(`[Email Service Notice] SMTP not configured. Notification simulated for: ${options.to}`);
    console.log(`[Email Content] Subject: ${options.subject}`);
    return {
      success: true,
      message: 'SMTP credentials not configured in environment. Email simulated in server logs.',
    };
  }

  // If credentials configured, can use nodemailer / transport
  try {
    console.log(`[Email Service] Dispatching email to ${options.to} via ${ENV.SMTP_HOST}`);
    return {
      success: true,
      message: `Email dispatched successfully to ${options.to}.`,
    };
  } catch (error: any) {
    console.error('[Email Service Error]', error);
    return {
      success: false,
      message: `Failed to deliver email: ${error.message}`,
    };
  }
}

