import { Types } from 'mongoose';
import { StudentLabSession, IStudentLabSession } from './model';
import { ILab } from '../labs/model';
import { Enrollment } from '../enrollments/model';

/**
 * StudentLabSession Service
 * Manages permanent Management IP assignments for student lab sessions
 */
export class StudentLabSessionService {

  /**
   * Get or create student lab session with Management IP assignment
   *
   * Logic:
   * - If active session exists: return existing IP
   * - If no active session or previous completed: create new session with new IP
   */
  static async getOrCreateSession(
    studentId: string,
    labId: Types.ObjectId,
    lab: ILab
  ): Promise<IStudentLabSession> {
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
    const studentIndex = await this.getStudentIndex(lab.courseId, studentId);
    const managementIp = await this.calculateManagementIP(lab, studentIndex);

    const newSession = new StudentLabSession({
      studentId,
      labId,
      courseId: lab.courseId,
      managementIp,
      studentIndex,
      status: 'active',
      startedAt: new Date(),
      lastAccessedAt: new Date()
    });

    return await newSession.save();
  }

  /**
   * Delete session immediately (releases IP for reassignment)
   * Used when student completes ALL parts of a lab OR lab times out
   */
  static async deleteSession(
    studentId: string,
    labId: Types.ObjectId
  ): Promise<void> {
    await StudentLabSession.deleteOne({
      studentId,
      labId,
      status: 'active'
    });
  }

  /**
   * Mark session as completed (DEPRECATED - use deleteSession instead)
   * Kept for backwards compatibility
   */
  static async completeSession(
    studentId: string,
    labId: Types.ObjectId
  ): Promise<IStudentLabSession | null> {
    return await StudentLabSession.findOneAndUpdate(
      {
        studentId,
        labId,
        status: 'active'
      },
      {
        status: 'completed',
        completedAt: new Date()
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
   * Get student enrollment index (1-based) using enrollment order
   * Uses actual Enrollment model schema: { u_id, c_id, u_role, enrollmentDate }
   */
  private static async getStudentIndex(
    courseId: Types.ObjectId,
    studentId: string
  ): Promise<number> {
    try {
      // Get all student enrollments for this course, sorted by enrollment date
      const enrollments = await Enrollment.find({
        c_id: courseId.toString(),
        u_role: 'STUDENT'
      })
      .sort({ enrollmentDate: 1 })
      .lean();

      // Find the student's position in the enrollment order
      const studentIndex = enrollments.findIndex(
        enrollment => enrollment.u_id === studentId
      );

      if (studentIndex === -1) {
        throw new Error(`Student ${studentId} not found in course enrollments`);
      }

      // Return 1-based index (first student gets index 1, not 0)
      return studentIndex + 1;
    } catch (error) {
      throw new Error(`Error getting student index: ${(error as Error).message}`);
    }
  }

  /**
   * Calculate Management IP based on student index and lab network configuration
   * Uses enrollment-order algorithm and skips exempt IP ranges
   */
  private static async calculateManagementIP(
    lab: ILab,
    studentIndex: number
  ): Promise<string> {
    try {
      const baseIp = lab.network.topology.baseNetwork;
      const subnetMask = lab.network.topology.subnetMask;
      const exemptRanges = lab.network.topology.exemptIpRanges;

      // Convert base IP to long integer
      const baseIpLong = this.ipToLong(baseIp);

      // Calculate student subnet offset
      const studentOffset = studentIndex * Math.pow(2, (32 - subnetMask));

      // Management IP is at the first host in student's subnet
      // Typically: base + studentOffset + 1 (skip network address)
      let managementIpLong = baseIpLong + studentOffset + 1;
      let candidateIp = this.longToIp(managementIpLong);

      // Skip exempt IPs with max attempts protection
      let attempts = 0;
      const maxAttempts = 1000;

      while (this.isIpInExemptRanges(candidateIp, exemptRanges) && attempts < maxAttempts) {
        managementIpLong++;
        candidateIp = this.longToIp(managementIpLong);
        attempts++;
      }

      if (attempts >= maxAttempts) {
        const exemptCount = exemptRanges?.length || 0;
        const totalExemptIps = exemptRanges?.reduce((sum, range) => {
          if (range.end) {
            return sum + (this.ipToLong(range.end) - this.ipToLong(range.start) + 1);
          }
          return sum + 1;
        }, 0) || 0;

        throw new Error(
          `Unable to assign Management IP for student index ${studentIndex}. ` +
          `Too many exempt ranges (${exemptCount} ranges, ${totalExemptIps} IPs exempt). ` +
          `Please reduce exempt ranges or expand management network.`
        );
      }

      // Log if IPs were skipped (for debugging)
      if (attempts > 0) {
        console.log(
          `[IP Assignment] Student index ${studentIndex} skipped ${attempts} exempt IP(s), assigned ${candidateIp}`
        );
      }

      return candidateIp;
    } catch (error) {
      throw new Error(`Error calculating management IP: ${(error as Error).message}`);
    }
  }

  /**
   * Check if IP is in any exempt range
   */
  private static isIpInExemptRanges(
    ip: string,
    exemptRanges: Array<{ start: string; end?: string }> | undefined
  ): boolean {
    if (!exemptRanges || exemptRanges.length === 0) {
      return false;
    }

    const ipNum = this.ipToLong(ip);

    for (const range of exemptRanges) {
      const startNum = this.ipToLong(range.start);
      const endNum = range.end ? this.ipToLong(range.end) : startNum;

      if (ipNum >= startNum && ipNum <= endNum) {
        return true;
      }
    }

    return false;
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
   * Calculate available IP capacity considering exempt ranges
   * Returns capacity information for validation
   */
  static async calculateIpCapacity(
    lab: ILab
  ): Promise<{
    totalIps: number;
    exemptCount: number;
    available: number;
    enrolledStudents: number;
    sufficient: boolean;
  }> {
    try {
      const { baseNetwork, subnetMask, exemptIpRanges } = lab.network.topology;

      // Total usable IPs in management network (excluding network & broadcast)
      const totalIps = Math.pow(2, 32 - subnetMask) - 2;

      // Count exempt IPs
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

      // Count enrolled STUDENTS in this lab's course
      const enrolledStudents = await Enrollment.countDocuments({
        c_id: lab.courseId.toString(),
        u_role: 'STUDENT'
      });

      const available = totalIps - exemptCount;
      const sufficient = available >= enrolledStudents;

      return {
        totalIps,
        exemptCount,
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
   */
  static async reassignConflictedIPs(
    labId: Types.ObjectId,
    lab: ILab,
    conflictedStudentIds: string[]
  ): Promise<number> {
    let reassignedCount = 0;

    for (const studentId of conflictedStudentIds) {
      const session = await StudentLabSession.findOne({
        studentId,
        labId,
        status: 'active'
      });

      if (!session) continue;

      // Calculate new Management IP that avoids exempt ranges
      const newManagementIp = await this.calculateManagementIP(lab, session.studentIndex);

      // Update session with new IP
      session.managementIp = newManagementIp;
      session.lastAccessedAt = new Date();
      await session.save();

      reassignedCount++;
    }

    return reassignedCount;
  }
}
