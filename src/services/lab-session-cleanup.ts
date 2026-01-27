import { Types } from 'mongoose';
import { StudentLabSession } from '../modules/student-lab-sessions/model';
import { StudentLabSessionService } from '../modules/student-lab-sessions/service';
import { Lab, ILab } from '../modules/labs/model';

/**
 * Cleanup service for expired lab sessions
 * Releases IPs when labs timeout (reach availableUntil or dueDate)
 */
export class LabSessionCleanupService {

  /**
   * Release IPs for labs that have timed out
   * Should be run as scheduled job (cron/interval)
   */
  static async cleanupExpiredLabSessions(): Promise<{
    released: number;
    details: Array<{ studentId: string; labTitle: string; ip: string; reason: string }>;
  }> {
    const now = new Date();

    // Find all active sessions and populate lab data
    const activeSessions = await StudentLabSession.find({
      status: 'active'
    }).populate('labId');

    const releasedDetails: Array<{ studentId: string; labTitle: string; ip: string; reason: string }> = [];

    for (const session of activeSessions) {
      const lab = session.labId as any as ILab; // Populated Lab document

      if (!lab) {
        console.warn(`[Cleanup Warning] Session ${session._id} has invalid labId reference`);
        continue;
      }

      let shouldRelease = false;
      let reason = '';

      // Check if lab has reached availableUntil (hard deadline - lab becomes inaccessible)
      // Note: dueDate (soft deadline) does NOT close sessions - students can still work
      // after dueDate with a late penalty applied to their scores
      if (lab.availableUntil && new Date(lab.availableUntil) < now) {
        shouldRelease = true;
        reason = `Lab unavailable after ${lab.availableUntil}`;
      }

      if (shouldRelease) {
        // Mark session as completed and release IP
        await StudentLabSessionService.deleteSession(
          session.studentId,
          session.labId as Types.ObjectId,
          { reason: 'timeout' }
        );

        releasedDetails.push({
          studentId: session.studentId,
          labTitle: lab.title,
          ip: session.managementIp,
          reason
        });

        console.log(
          `[Timeout Cleanup] Released IP ${session.managementIp} for student ${session.studentId} - Lab "${lab.title}" - ${reason}`
        );
      }
    }

    return {
      released: releasedDetails.length,
      details: releasedDetails
    };
  }

  /**
   * Cleanup old completed sessions for housekeeping
   * Note: With deleteSession(), there shouldn't be many 'completed' sessions
   * This is just for cleanup of any that exist from old logic
   */
  static async cleanupOldCompletedSessions(retentionDays: number = 90): Promise<{
    deleted: number;
    message: string;
  }> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    const result = await StudentLabSession.deleteMany({
      status: 'completed',
      completedAt: { $lt: cutoffDate }
    });

    const message = `Deleted ${result.deletedCount} old completed sessions (older than ${retentionDays} days)`;

    if (result.deletedCount > 0) {
      console.log(`[Housekeeping] ${message}`);
    }

    return {
      deleted: result.deletedCount,
      message
    };
  }

  /**
   * Get statistics about current sessions
   */
  static async getSessionStats(): Promise<{
    activeSessions: number;
    completedSessions: number;
    expiringSoon: number; // Labs expiring in next 24 hours
  }> {
    const activeCount = await StudentLabSession.countDocuments({ status: 'active' });
    const completedCount = await StudentLabSession.countDocuments({ status: 'completed' });

    // Find sessions with labs expiring in next 24 hours
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);

    const expiringSessions = await StudentLabSession.find({
      status: 'active'
    }).populate('labId');

    let expiringSoonCount = 0;
    for (const session of expiringSessions) {
      const lab = session.labId as any as ILab;
      if (lab && lab.availableUntil && new Date(lab.availableUntil) < tomorrow) {
        expiringSoonCount++;
      }
    }

    return {
      activeSessions: activeCount,
      completedSessions: completedCount,
      expiringSoon: expiringSoonCount
    };
  }
}
