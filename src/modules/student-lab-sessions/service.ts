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
   * Uses enrollment-order algorithm from ip-allocation.ts
   */
  private static async calculateManagementIP(
    lab: ILab,
    studentIndex: number
  ): Promise<string> {
    try {
      const baseIp = lab.network.topology.baseNetwork;
      const subnetMask = lab.network.topology.subnetMask;

      // Convert base IP to long integer
      const baseIpLong = this.ipToLong(baseIp);

      // Calculate student subnet offset
      const studentOffset = studentIndex * Math.pow(2, (32 - subnetMask));

      // Management IP is at the first host in student's subnet
      // Typically: base + studentOffset + 1 (skip network address)
      const managementIpLong = baseIpLong + studentOffset + 1;

      return this.longToIp(managementIpLong);
    } catch (error) {
      throw new Error(`Error calculating management IP: ${(error as Error).message}`);
    }
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
}
