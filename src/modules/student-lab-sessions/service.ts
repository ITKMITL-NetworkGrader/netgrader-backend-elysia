import { Types } from 'mongoose';
import { StudentLabSession, IStudentLabSession } from './model';
import { ILab } from '../labs/model';
import { Enrollment } from '../enrollments/model';

type ReleaseReason = 'completion' | 'restart' | 'timeout' | 'admin';
const RELEASE_REASONS: ReadonlyArray<ReleaseReason> = ['completion', 'restart', 'timeout', 'admin'];

/**
 * StudentLabSession Service
 * Manages dynamic Management IP assignments for student lab sessions
 *
 * IP Assignment Strategy:
 * - IPs are assigned dynamically based on availability, not enrollment order
 * - Merges exempt IP ranges with currently assigned IPs to find available IPs
 * - Validates IPs are within subnet boundaries (excludes network/broadcast addresses)
 * - Uses MongoDB unique index + retry logic to prevent race conditions
 */
export class StudentLabSessionService {
  private static releaseReasonOrDefault(reason?: ReleaseReason): ReleaseReason {
    return reason && RELEASE_REASONS.includes(reason) ? reason : 'completion';
  }

  /**
   * Get or create student lab session with Management IP assignment
   *
   * Logic:
   * - If active session exists: return existing IP
   * - If no active session or previous completed: create new session with new IP
   * - Uses retry logic with unique index to prevent race conditions
   */
  static async getOrCreateSession(
    studentId: string,
    labId: Types.ObjectId,
    lab: ILab
  ): Promise<IStudentLabSession> {
    const MAX_RETRIES = 5;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        // Check for existing active session
        const existingSession = await StudentLabSession.findOne({
          studentId,
          labId,
          status: 'active'
        });

        if (existingSession) {
          // Update last accessed time
          existingSession.lastAccessedAt = new Date();
          await existingSession.save();
          return existingSession;
        }

        // No active session - create new one with new IP
        const managementIp = await this.calculateManagementIP(lab);

        // Determine next attempt number (monotonic counter)
        const latestSession = await StudentLabSession.findOne({
          studentId,
          labId
        }).sort({ attemptNumber: -1, createdAt: -1 });

        const nextAttemptNumber = latestSession ? latestSession.attemptNumber + 1 : 1;

        const newSession = new StudentLabSession({
          studentId,
          labId,
          courseId: lab.courseId,
          managementIp,
          status: 'active',
          attemptNumber: nextAttemptNumber,
          previousSessionId: latestSession?._id ?? null,
          instructionsAcknowledged: false,
          startedAt: new Date(),
          lastAccessedAt: new Date()
        });

        return await newSession.save();

      } catch (error: any) {
        // Check if error is duplicate key (race condition on IP assignment)
        if (error.code === 11000 && attempt < MAX_RETRIES - 1) {
          // Another thread took this IP, wait briefly and retry
          const waitTime = 50 * (attempt + 1); // Exponential backoff: 50ms, 100ms, 150ms...
          await new Promise(resolve => setTimeout(resolve, waitTime));
          continue; // Retry with new IP calculation
        }

        // Not a duplicate key error or max retries reached
        throw new Error(`Failed to create session: ${error.message}`);
      }
    }

    throw new Error('Failed to assign IP after maximum retries. Please try again.');
  }

  /**
   * Delete session immediately (releases IP for reassignment)
   * Used when student completes ALL parts of a lab OR lab times out
   */
  static async deleteSession(
    studentId: string,
    labId: Types.ObjectId,
    options?: {
      reason?: ReleaseReason;
      completedAt?: Date;
    }
  ): Promise<void> {
    await this.releaseActiveSession(
      studentId,
      labId,
      this.releaseReasonOrDefault(options?.reason),
      options?.completedAt
    );
  }

  /**
   * Restart session by closing current attempt and creating a new one
   */
  static async restartSession(
    studentId: string,
    labId: Types.ObjectId,
    lab: ILab
  ): Promise<IStudentLabSession> {
    await this.releaseActiveSession(studentId, labId, 'restart');
    return await this.getOrCreateSession(studentId, labId, lab);
  }

  /**
   * Mark session as completed (DEPRECATED - use deleteSession instead)
   * Kept for backwards compatibility
   */
  static async completeSession(
    studentId: string,
    labId: Types.ObjectId
  ): Promise<IStudentLabSession | null> {
    return await this.releaseActiveSession(studentId, labId, 'completion');
  }

  private static async releaseActiveSession(
    studentId: string,
    labId: Types.ObjectId,
    reason: ReleaseReason,
    completedAt?: Date
  ): Promise<IStudentLabSession | null> {
    return await StudentLabSession.findOneAndUpdate(
      {
        studentId,
        labId,
        status: 'active'
      },
      {
        status: 'completed',
        completedAt: completedAt ?? new Date(),
        releaseReason: this.releaseReasonOrDefault(reason),
        releasedAt: new Date(),
        lastAccessedAt: new Date()
      },
      { new: true }
    );
  }

  /**
   * Get student's current active session for a lab
   */
  static async getActiveSession(
    studentId: string,
    labId: Types.ObjectId
  ): Promise<IStudentLabSession | null> {
    return await StudentLabSession.findOne({
      studentId,
      labId,
      status: 'active'
    });
  }

  /**
   * Mark lab instructions as acknowledged for a student.
   */
  static async acknowledgeInstructions(
    studentId: string,
    labId: Types.ObjectId,
    lab: ILab
  ): Promise<IStudentLabSession> {
    const session = await this.getOrCreateSession(studentId, labId, lab);

    if (!session.instructionsAcknowledged) {
      session.instructionsAcknowledged = true;
      session.instructionsAcknowledgedAt = new Date();
      await session.save();
    }

    return session;
  }

  /**
   * Check if instructions have been acknowledged by student.
   */
  static async hasAcknowledgedInstructions(
    studentId: string,
    labId: Types.ObjectId
  ): Promise<boolean> {
    const session = await StudentLabSession.findOne({
      studentId,
      labId,
      status: 'active'
    }).select('instructionsAcknowledged');

    return !!session?.instructionsAcknowledged;
  }

  /**
   * Get all sessions for a student
   */
  static async getStudentSessions(
    studentId: string,
    options?: {
      labId?: Types.ObjectId;
      status?: 'active' | 'completed';
    }
  ): Promise<IStudentLabSession[]> {
    const query: any = { studentId };

    if (options?.labId) {
      query.labId = options.labId;
    }

    if (options?.status) {
      query.status = options.status;
    }

    return await StudentLabSession.find(query)
      .populate('labId', 'title')
      .sort({ startedAt: -1 });
  }

  /**
   * Get all active sessions for a lab
   */
  static async getLabActiveSessions(labId: Types.ObjectId): Promise<IStudentLabSession[]> {
    return await StudentLabSession.find({
      labId,
      status: 'active'
    }).sort({ studentIndex: 1 });
  }


  /**
   * Calculate Management IP based on lab network configuration
   * Finds the first available IP by checking exempt ranges and assigned IPs
   *
   * Algorithm:
   * 1. Merge exempt IP ranges with currently assigned IPs
   * 2. Find first available IP starting from baseIp + 1
   * 3. Validate IP is within subnet boundaries (excludes network/broadcast addresses)
   */
  private static async calculateManagementIP(
    lab: ILab
  ): Promise<string> {
    try {
      const baseIp = lab.network.topology.baseNetwork;
      const subnetMask = lab.network.topology.subnetMask;
      let exemptRanges = lab.network.topology.exemptIpRanges || [];

      // Convert base IP to long integer
      let baseIpLong = this.ipToLong(baseIp);

      const mergedExemptRanges = this.adjustExemptRanges(
        exemptRanges.map(r => ({ start: r.start, end: r.end || r.start })),
        await this.getAssignedIpRanges(lab.id)
      );
      console.log(`Merged Exempt Ranges:`, mergedExemptRanges.map(r => ({ start: this.longToIp(r.start), end: this.longToIp(r.end) }))) // --- IGNORE ---

      const candidateIp = this.getAvailableIp(
        baseIpLong + 1,
        mergedExemptRanges.map(r => ({ start: this.longToIp(r.start), end: this.longToIp(r.end) })),
        baseIp,
        subnetMask
      );

      if (!candidateIp) {
        throw new Error('No available IPs in subnet. All IPs are either exempt or assigned.');
      }

      return candidateIp;
    } catch (error) {
      throw new Error(`Error calculating management IP: ${(error as Error).message}`);
    }
  }

  private static getAvailableIp(
    iplong: number,
    exemptRanges: Array<{ start: string; end?: string }>,
    baseIp: string,
    subnetMask: number
  ): string | null {
    // Logic to find the next available IP address within subnet boundaries
    if (!exemptRanges || exemptRanges.length === 0) {
      // Check if IP is within valid range (excluding network and broadcast)
      if (this.isIpInSubnet(iplong, baseIp, subnetMask)) {
        return this.longToIp(iplong);
      }
      return null; // No available IP
    }

    for (const range of exemptRanges) {
      const startNum = this.ipToLong(range.start);
      const endNum = range.end ? this.ipToLong(range.end) : startNum;

      if (iplong >= startNum && iplong <= endNum) {
        iplong = endNum + 1;
      }
    }

    // Validate the final IP is within subnet boundaries
    if (this.isIpInSubnet(iplong, baseIp, subnetMask)) {
      return this.longToIp(iplong);
    }

    // IP exhausted - outside valid range
    return null;
  }

  private static adjustExemptRanges(
    exemptRanges: Array<{ start: string; end: string }>,
    assignedIps: Array<{ start: string; end: string }>
  ): Array<{ start: number; end: number }> {
    exemptRanges = exemptRanges.concat(assignedIps);
    const sorted = [...exemptRanges].sort((a, b) => this.ipToLong(a.start) - this.ipToLong(b.start));
    const merged: Array<{ start: number; end: number }> = [];
    for (const range of sorted) {
      const startNum = this.ipToLong(range.start);
      const endNum = this.ipToLong(range.end);

      if (merged.length === 0) {
        merged.push({ start: startNum, end: endNum });
      } else {
        const last = merged[merged.length - 1];
        if (startNum <= last.end + 1) {
          // Overlapping or contiguous ranges, merge them
          last.end = Math.max(last.end, endNum);
        } else {
          // Non-overlapping range, add to list
          merged.push({ start: startNum, end: endNum });
        }
      }
    }

    return merged;
  }

  /**
   * Check if Management IP is available (not assigned to active session)
   */
  static async isIpAvailable(labId: Types.ObjectId, ipAddress: string): Promise<boolean> {
    const existingSession = await StudentLabSession.findOne({
      labId,
      managementIp: ipAddress,
      status: 'active'
    });

    return !existingSession;
  }

  /**
   * Get IP assignment statistics for a lab
   */
  static async getLabIpStats(labId: Types.ObjectId): Promise<{
    totalActiveSessions: number;
    activeIps: string[];
    completedSessions: number;
  }> {
    const activeSessions = await StudentLabSession.find({
      labId,
      status: 'active'
    });

    const completedCount = await StudentLabSession.countDocuments({
      labId,
      status: 'completed'
    });

    return {
      totalActiveSessions: activeSessions.length,
      activeIps: activeSessions.map(s => s.managementIp),
      completedSessions: completedCount
    };
  }

  /**
   * Utility: Convert IP address string to long integer
   */
  private static ipToLong(ip: string): number {
    const parts = ip.split('.').map(part => parseInt(part, 10));
    return (parts[0] << 24) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
  }

  /**
   * Utility: Convert long integer to IP address string
   */
  private static longToIp(long: number): string {
    return [
      (long >>> 24) & 0xFF,
      (long >>> 16) & 0xFF,
      (long >>> 8) & 0xFF,
      long & 0xFF
    ].join('.');
  }

  /**
   * Calculate broadcast address from base IP (network address) and subnet mask
   * baseIp is always the network address
   */
  private static getBroadcastAddress(baseIp: string, subnetMask: number): number {
    const networkAddress = this.ipToLong(baseIp);
    const hostBits = 32 - subnetMask;
    return (networkAddress | ((1 << hostBits) - 1)) >>> 0;
  }

  /**
   * Check if an IP is within the valid subnet range
   * Excludes network address (baseIp) and broadcast address
   */
  private static isIpInSubnet(ipLong: number, baseIp: string, subnetMask: number): boolean {
    const networkAddress = this.ipToLong(baseIp);
    const broadcastAddress = this.getBroadcastAddress(baseIp, subnetMask);

    // IP must be between network and broadcast (exclusive)
    return ipLong > networkAddress && ipLong < broadcastAddress;
  }

  /**
   * Calculate available IP capacity considering exempt ranges and assigned IPs
   * Returns capacity information for validation
   * Uses merged ranges for accurate calculation (same logic as IP assignment)
   */
  static async calculateIpCapacity(
    lab: ILab
  ): Promise<{
    totalIps: number;
    exemptCount: number;
    assignedCount: number;
    totalBlocked: number;
    available: number;
    enrolledStudents: number;
    sufficient: boolean;
  }> {
    try {
      const { subnetMask, exemptIpRanges } = lab.network.topology;

      // Total usable IPs in management network (excluding network & broadcast)
      const totalIps = Math.pow(2, 32 - subnetMask) - 2;

      // Count configured exempt IPs (for transparency)
      let exemptCount = 0;
      if (exemptIpRanges && exemptIpRanges.length > 0) {
        for (const range of exemptIpRanges) {
          if (range.end) {
            const startNum = this.ipToLong(range.start);
            const endNum = this.ipToLong(range.end);
            exemptCount += (endNum - startNum + 1);
          } else {
            exemptCount += 1;
          }
        }
      }

      // Get assigned IPs
      const assignedIps = await this.getAssignedIpRanges(lab.id);
      const assignedCount = assignedIps.length;

      // Merge exempt and assigned ranges for accurate count
      const mergedExemptRanges = this.adjustExemptRanges(
        (exemptIpRanges || []).map(r => ({ start: r.start, end: r.end || r.start })),
        assignedIps
      );

      // Count total blocked IPs from merged ranges
      let totalBlocked = 0;
      for (const range of mergedExemptRanges) {
        totalBlocked += (range.end - range.start + 1);
      }

      // Count enrolled STUDENTS in this lab's course
      const enrolledStudents = await Enrollment.countDocuments({
        c_id: lab.courseId.toString(),
        u_role: 'STUDENT'
      });

      const available = totalIps - totalBlocked;
      const sufficient = available >= enrolledStudents;

      return {
        totalIps,
        exemptCount,
        assignedCount,
        totalBlocked,
        available,
        enrolledStudents,
        sufficient
      };
    } catch (error) {
      throw new Error(`Error calculating IP capacity: ${(error as Error).message}`);
    }
  }

  /**
   * Find sessions that would conflict with new exempt ranges
   */
  static async findConflictingSessions(
    labId: Types.ObjectId,
    newExemptRanges: Array<{ start: string; end?: string }>
  ): Promise<Array<{ studentId: string; managementIp: string }>> {
    if (!newExemptRanges || newExemptRanges.length === 0) {
      return [];
    }

    const activeSessions = await StudentLabSession.find({
      labId,
      status: 'active'
    });

    const conflicts: Array<{ studentId: string; managementIp: string }> = [];

    for (const session of activeSessions) {
      const ipNum = this.ipToLong(session.managementIp);

      for (const range of newExemptRanges) {
        const startNum = this.ipToLong(range.start);
        const endNum = range.end ? this.ipToLong(range.end) : startNum;

        if (ipNum >= startNum && ipNum <= endNum) {
          conflicts.push({
            studentId: session.studentId,
            managementIp: session.managementIp
          });
          break; // No need to check other ranges for this session
        }
      }
    }

    return conflicts;
  }

  /**
   * Reassign Management IPs for conflicted sessions
   * Called when instructor confirms exempt range update that conflicts with active sessions
   *
   * Strategy:
   * 1. Temporarily remove old conflicted IPs from database (release them)
   * 2. Calculate new IPs (which won't see the old IPs as assigned anymore)
   * 3. Update sessions with new IPs
   */
  static async reassignConflictedIPs(
    labId: Types.ObjectId,
    lab: ILab,
    conflictedStudentIds: string[]
  ): Promise<number> {
    let reassignedCount = 0;

    // Collect all conflicted sessions first
    const conflictedSessions = await StudentLabSession.find({
      studentId: { $in: conflictedStudentIds },
      labId,
      status: 'active'
    });

    // Temporarily delete all conflicted sessions to release their IPs
    await StudentLabSession.deleteMany({
      studentId: { $in: conflictedStudentIds },
      labId,
      status: 'active'
    });

    // Reassign new IPs for each student
    for (const oldSession of conflictedSessions) {
      try {
        // Calculate new Management IP (won't see old IP as assigned anymore)
        const newManagementIp = await this.calculateManagementIP(lab);

        // Recreate session with new IP
        const newSession = new StudentLabSession({
          _id: oldSession._id,
          studentId: oldSession.studentId,
          labId: oldSession.labId,
          courseId: oldSession.courseId,
          managementIp: newManagementIp,
          status: 'active',
          attemptNumber: oldSession.attemptNumber,
          previousSessionId: oldSession.previousSessionId ?? null,
          instructionsAcknowledged: oldSession.instructionsAcknowledged,
          instructionsAcknowledgedAt: oldSession.instructionsAcknowledgedAt,
          startedAt: oldSession.startedAt, // Preserve original start time
          lastAccessedAt: new Date()
        });

        await newSession.save();
        reassignedCount++;

      } catch (error) {
        console.error(`Failed to reassign IP for student ${oldSession.studentId}:`, error);
        // Continue with other students even if one fails
      }
    }

    return reassignedCount;
  }

  /**
   * Get list of assigned management IPs from active student lab sessions
   * Maps them to range format {start: IP, end: IP} for concatenation with exempt ranges
   *
   * @param labId - The lab ID to get assigned IPs for
   * @returns Array of IP ranges where start and end are the same (single IP addresses)
   */
  static async getAssignedIpRanges(
    labId: string
  ): Promise<Array<{ start: string; end: string }>> {
    const activeSessions = await StudentLabSession.find({
      labId,
      status: 'active'
    }).select('managementIp');

    // Map each assigned IP to range format {start: IP, end: IP}
    return activeSessions.map(session => ({
      start: session.managementIp,
      end: session.managementIp
    }));
  }

  static async getAssignedIps(
    labId: string
  ): Promise<Array<{ studentId: string; username: string; mgntIp: string }>> {
    const activeSessions = await StudentLabSession.aggregate([
      {
        $match: {
          labId: new Types.ObjectId(labId),
          status: 'active'
        }
      },
      {
        $lookup: {
          from: 'users',
          localField: 'studentId',
          foreignField: 'u_id',
          as: 'userInfo'
        }
      },
      {
        $unwind: {
          path: '$userInfo',
          preserveNullAndEmptyArrays: true
        }
      },
      {
        $project: {
          studentId: 1,
          username: { $ifNull: ['$userInfo.fullName', 'Unknown User'] },
          mgntIp: '$managementIp'
        }
      }
    ]);

    return activeSessions.map(session => ({
      studentId: session.studentId,
      username: session.username,
      mgntIp: session.mgntIp
    }));
  }
}
