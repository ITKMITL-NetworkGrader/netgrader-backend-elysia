import { Types } from 'mongoose';
import { ILab } from '../modules/labs/model';
import { Enrollment } from '../modules/enrollments/model';
import { CacheService } from '../config/redis';

/**
 * IP Address Allocation Service
 * Dynamically calculates student IP assignments based on lab configuration
 */
export class IpAllocationService {

  /**
   * Calculate IP addresses for a student based on lab network configuration
   */
  static async calculateStudentIPs(lab: ILab, studentId: Types.ObjectId): Promise<Record<string, string>> {
    try {
      // Check cache first
      const cached = await CacheService.getStudentIPs(lab._id.toString(), studentId.toString());
      if (cached) {
        return cached;
      }

      // Get student enrollment to determine their index
      const studentIndex = await this.getStudentIndex(lab.courseId, studentId);
      
      const assignments: Record<string, string> = {};
      
      // Parse base network
      const baseIp = this.ipToLong(lab.network.topology.baseNetwork);
      const subnetMask = lab.network.topology.subnetMask;
      
      // Calculate student subnet offset
      // Each student gets their own subnet based on their enrollment order
      const studentOffset = studentIndex * Math.pow(2, (32 - subnetMask));
      
      lab.network.devices.forEach(device => {
        device.ipVariables.forEach(ipVar => {
          // Calculate final IP: base + student offset + host offset
          const finalIpLong = baseIp + studentOffset + ipVar.hostOffset;
          const finalIp = this.longToIp(finalIpLong);
          
          // Store with device_variable naming convention
          assignments[`${device.deviceId}_${ipVar.name}`] = finalIp;
        });
      });

      // Cache the result for lab duration
      await CacheService.setStudentIPs(lab._id.toString(), studentId.toString(), assignments);
      
      return assignments;
    } catch (error) {
      throw new Error(`Error calculating student IPs: ${(error as Error).message}`);
    }
  }

  /**
   * Get student index based on enrollment order in course
   */
  private static async getStudentIndex(courseId: Types.ObjectId, studentId: Types.ObjectId): Promise<number> {
    try {
      // Get all student enrollments for this course, sorted by enrollment date
      const enrollments = await Enrollment.find({ 
        courseId: courseId,
        role: 'STUDENT',
        enrollmentStatus: 'active'
      })
      .sort({ enrolledAt: 1 })
      .lean();

      // Find the student's position in the enrollment order
      const studentIndex = enrollments.findIndex(
        enrollment => enrollment.userId.toString() === studentId.toString()
      );

      if (studentIndex === -1) {
        throw new Error('Student not found in course enrollments');
      }

      // Return 1-based index (first student gets index 1, not 0)
      return studentIndex + 1;
    } catch (error) {
      throw new Error(`Error getting student index: ${(error as Error).message}`);
    }
  }

  /**
   * Convert IP address string to long integer
   */
  private static ipToLong(ip: string): number {
    const parts = ip.split('.').map(part => parseInt(part, 10));
    return (parts[0] << 24) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
  }

  /**
   * Convert long integer to IP address string
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
   * Validate that network configuration has sufficient IP capacity
   */
  static validateNetworkCapacity(lab: ILab, maxStudents: number): boolean {
    try {
      const subnetMask = lab.network.topology.subnetMask;
      const subnetSize = Math.pow(2, (32 - subnetMask));
      
      // Calculate required IPs per student
      const deviceCount = lab.network.devices.length;
      const maxHostOffset = Math.max(
        ...lab.network.devices.flatMap(device => 
          device.ipVariables.map(ipVar => ipVar.hostOffset)
        )
      );

      // Each student needs space for their highest host offset
      const requiredIpSpacePerStudent = maxHostOffset + 1;
      
      // Check if we have enough subnet space
      const availableSpace = subnetSize * maxStudents;
      const requiredSpace = requiredIpSpacePerStudent * maxStudents;

      return availableSpace >= requiredSpace;
    } catch (error) {
      console.error('Error validating network capacity:', error);
      return false;
    }
  }

  /**
   * Clear IP cache for a specific lab (useful when lab network config changes)
   */
  static async clearLabIPCache(labId: string) {
    try {
      await CacheService.clearCachePattern(`ips:${labId}:*`);
    } catch (error) {
      console.error('Error clearing lab IP cache:', error);
    }
  }

  /**
   * Get all IP assignments for a lab (for debugging/admin purposes)
   */
  static async getAllLabIPAssignments(lab: ILab): Promise<Record<string, Record<string, string>>> {
    try {
      // Get all active student enrollments for this course
      const enrollments = await Enrollment.find({
        courseId: lab.courseId,
        role: 'STUDENT',
        enrollmentStatus: 'active'
      })
      .sort({ enrolledAt: 1 })
      .lean();

      const allAssignments: Record<string, Record<string, string>> = {};

      // Calculate IPs for each student
      for (const enrollment of enrollments) {
        const studentIPs = await this.calculateStudentIPs(lab, enrollment.userId);
        allAssignments[enrollment.userId.toString()] = studentIPs;
      }

      return allAssignments;
    } catch (error) {
      throw new Error(`Error getting all lab IP assignments: ${(error as Error).message}`);
    }
  }
}