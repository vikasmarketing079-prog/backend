import { ScheduledScan } from '../models/ScheduledScan.js';
import { AuditService } from '../services/auditService.js';
import { sendEmailNotification } from '../services/emailService.js';
import { Notification } from '../models/Notification.js';

export class ScheduledScanWorker {
  private static isRunning = false;
  private static timer: NodeJS.Timeout | null = null;

  /**
   * Starts the recurring background schedule checker
   */
  public static start(intervalMs = 600000): void { // default: check every 10 minutes
    if (this.timer) return;
    console.log('[Scheduler] Background audit monitoring worker started (interval: 10 mins).');

    // Run first check after 30 seconds
    setTimeout(() => {
      this.checkAndExecuteScheduledScans().catch((err) =>
        console.error('[Scheduler Error]', err)
      );
    }, 30000);

    this.timer = setInterval(() => {
      this.checkAndExecuteScheduledScans().catch((err) =>
        console.error('[Scheduler Error]', err)
      );
    }, intervalMs);
  }

  public static stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      console.log('[Scheduler] Background worker stopped.');
    }
  }

  /**
   * Checks database for pending scheduled scans
   */
  public static async checkAndExecuteScheduledScans(): Promise<number> {
    if (this.isRunning) return 0;
    this.isRunning = true;

    let executedCount = 0;
    try {
      const now = new Date();
      const pendingScans = await ScheduledScan.find({
        enabled: true,
        nextRunAt: { $lte: now },
      }).limit(5);

      for (const scan of pendingScans) {
        try {
          console.log(`[Scheduler] Executing scheduled scan for: ${scan.targetUrl} (${scan.frequency})`);

          const audit = await AuditService.startAudit({
            url: scan.targetUrl,
            userId: scan.user?.toString(),
            websiteId: scan.website?.toString(),
            maxPages: scan.maxPages || 50,
            crawlDepth: scan.crawlDepth || 2,
          });

          // Compute next run date
          const next = new Date();
          if (scan.frequency === 'daily') {
            next.setDate(next.getDate() + 1);
          } else if (scan.frequency === 'weekly') {
            next.setDate(next.getDate() + 7);
          } else if (scan.frequency === 'monthly') {
            next.setDate(next.getDate() + 30);
          }

          scan.lastRunAt = now;
          scan.nextRunAt = next;
          await scan.save();

          // Create notification
          if (scan.user) {
            await Notification.create({
              user: scan.user,
              title: `Scheduled Scan Started: ${scan.targetUrl}`,
              message: `Your scheduled ${scan.frequency} audit was dispatched successfully.`,
              type: 'scan_completed',
              link: `/report/${audit._id}`,
            });
          }

          // Email notification if configured
          if (scan.notifyEmail) {
            await sendEmailNotification({
              to: scan.notifyEmail,
              subject: `Scheduled Audit Running for ${scan.targetUrl}`,
              html: `
                <p>Hello,</p>
                <p>Your scheduled <strong>${scan.frequency}</strong> website health scan for <strong>${scan.targetUrl}</strong> has been initiated.</p>
                <p>You can view the real-time progress and final report in your SiteAudit Pro dashboard.</p>
              `,
            });
          }

          executedCount++;
        } catch (scanErr: any) {
          console.error(`[Scheduler] Failed scan for ${scan.targetUrl}:`, scanErr.message);
        }
      }
    } finally {
      this.isRunning = false;
    }

    return executedCount;
  }
}
