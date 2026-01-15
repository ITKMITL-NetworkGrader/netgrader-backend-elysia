import { Enrollment, IEnrollment } from "./model";
import { Course, ICourse } from "../courses/model";

interface CourseMember {
  u_id: string;
  fullName: string;
  u_role: "INSTRUCTOR" | "STUDENT" | "TA";
  enrollmentDate: Date;
  profilePicture?: string;
}

export class EnrollmentServiceError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

export class EnrollmentService {
  static async getAllEnrollments(): Promise<IEnrollment[]> {
    try {
      const enrollments = await Enrollment.find();
      return enrollments;
    } catch (error) {
      console.error("Error fetching all enrollments:", error);
      throw new Error("Failed to fetch enrollments.");
    }
  }
  static async createEnrollment(
    u_id: string,
    u_role: string,
    c_id: string,
    password?: string
  ): Promise<IEnrollment> {
    // First, check if enrollment already exists
    const existingEnrollment = await Enrollment.findOne({
      $and: [{ u_id: u_id }, { c_id: c_id }],
    });
    if (existingEnrollment) {
      throw new Error("Enrollment already exists for this user and course.");
    }

    // Find the course and include password field for validation
    const course = await Course.findById(c_id).select("+password");
    if (!course) {
      throw new Error("Course not found");
    }

    // Check if course requires password and validate it
    // Skip password validation if:
    // 1. Course creator is auto-enrolling as instructor, OR
    // 2. Course doesn't have a password
    const isCreatorEnrolling = u_role === "INSTRUCTOR" && course.created_by === u_id;

    if (course.password && course.password.trim() !== "" && !isCreatorEnrolling) {
      if (!password) {
        throw new Error("Course requires a password to enroll");
      }

      // Use promise-based password comparison
      const isPasswordValid = await new Promise<boolean>((resolve, reject) => {
        course.comparePassword(
          password,
          (err: Error | null, isMatch?: boolean) => {
            if (err) {
              reject(err);
            } else {
              resolve(isMatch || false);
            }
          }
        );
      });

      if (!isPasswordValid) {
        throw new Error("Invalid course password");
      }
    }

    // Create the enrollment
    const newEnrollment = new Enrollment({
      u_id: u_id,
      c_id: c_id,
      u_role: u_role,
    });

    try {
      await newEnrollment.save();
      return newEnrollment;
    } catch (error) {
      console.error("Error creating enrollment:", error);
      throw new Error("Failed to create enrollment.");
    }
  }

  static async getEnrollmentsByUserId(u_id: string): Promise<IEnrollment[]> {
    try {
      const enrollments = await Enrollment.find({ u_id: u_id });
      return enrollments;
    } catch (error) {
      console.error("Error fetching enrollments by user ID:", error);
      throw new Error("Failed to fetch enrollments.");
    }
  }

  static async getEnrollmentsByCourseId(c_id: string): Promise<CourseMember[]> {
    const courseExists = await Course.exists({ _id: c_id });
    if (!courseExists) {
      throw new Error("Course does not exist.");
    }
    try {
      const members = await this.getCourseMembers(c_id)
      return members;
    } catch (error) {
      console.error("Error fetching enrollments by course ID:", error);
      throw new Error("Failed to fetch enrollments.");
    }
  }

  static async deleteEnrollment(u_id: string, c_id: string): Promise<void> {
    const courseExists = await Course.exists({ _id: c_id });
    if (!courseExists) {
      throw new Error("Course does not exist.");
    }
    try {
      const result = await Enrollment.deleteOne({ u_id: u_id, c_id: c_id });
      if (result.deletedCount === 0) {
        throw new Error("Enrollment not found or already deleted.");
      }
    } catch (error) {
      console.error("Error deleting enrollment:", error);
      throw new Error("Failed to delete enrollment.");
    }
  }
  static async getUserEnrollmentStatus(
    c_id: string,
    u_id: string
  ): Promise<{ isEnrolled: boolean; role?: string; enrollmentDate?: Date }> {
    try {
      const enrollment = await Enrollment.findOne({ c_id, u_id });
      if (enrollment) {
        return {
          isEnrolled: true,
          role: enrollment.u_role,
          enrollmentDate: enrollment.enrollmentDate,
        };
      }
      return { isEnrolled: false };
    } catch (error) {
      console.error("Error checking user enrollment status:", error);
      throw new Error("Failed to check enrollment status.");
    }
  }

  private static async getCourseMembers(c_id: string): Promise<CourseMember[]> {
    const members = await Enrollment.aggregate([
      { $match: { c_id } },
      {
        $lookup: {
          from: "users", // collection name in MongoDB (usually lowercase plural)
          localField: "u_id",
          foreignField: "u_id",
          as: "userInfo",
        },
      },
      { $unwind: "$userInfo" },
      {
        $project: {
          _id: 0,
          u_id: 1,
          fullName: "$userInfo.fullName",
          u_role: 1,
          enrollmentDate: 1,
          profilePicturePath: "$userInfo.profilePicture",
        },
      },
    ]);

    // Generate presigned URLs for profile pictures
    const { storageService } = await import('../../services/storage');
    const membersWithUrls = await Promise.all(
      members.map(async (member) => {
        let profilePicture: string | undefined;
        if (member.profilePicturePath) {
          try {
            profilePicture = await storageService.getPresignedUrl(member.profilePicturePath);
          } catch (error) {
            console.error(`Error generating presigned URL for ${member.u_id}:`, error);
          }
        }
        return {
          u_id: member.u_id,
          fullName: member.fullName,
          u_role: member.u_role,
          enrollmentDate: member.enrollmentDate,
          profilePicture,
        };
      })
    );

    return membersWithUrls as CourseMember[];
  }

  static async manageCourseEnrollments(
    managerId: string,
    courseId: string,
    roleChanges: Array<{ u_id: string; newRole: "STUDENT" | "TA" }>,
    removals: string[]
  ): Promise<{ updated: Array<{ u_id: string; newRole: string }>; removed: string[] }> {
    const sanitizedCourseId = courseId;

    const managerEnrollment = await Enrollment.findOne({
      u_id: managerId,
      c_id: sanitizedCourseId
    });

    if (!managerEnrollment) {
      throw new EnrollmentServiceError("You are not enrolled in this course.", 403);
    }

    const managerRole = managerEnrollment.u_role;
    if (managerRole !== "INSTRUCTOR" && managerRole !== "TA") {
      throw new EnrollmentServiceError("You do not have permission to manage enrollments for this course.", 403);
    }

    const uniqueTargetIds = Array.from(new Set([
      ...roleChanges.map(change => change.u_id),
      ...removals
    ]));

    const targetEnrollments = await Enrollment.find({
      c_id: sanitizedCourseId,
      u_id: { $in: uniqueTargetIds }
    });

    const enrollmentMap = new Map<string, IEnrollment>(
      targetEnrollments.map(enrollment => [enrollment.u_id, enrollment])
    );

    const updated: Array<{ u_id: string; newRole: string }> = [];
    const removedResults: string[] = [];

    for (const change of roleChanges) {
      if (removals.includes(change.u_id)) {
        continue;
      }

      const enrollment = enrollmentMap.get(change.u_id);
      if (!enrollment) {
        throw new EnrollmentServiceError(`Enrollment not found for user ${change.u_id}`);
      }

      if (change.newRole === enrollment.u_role) {
        continue;
      }

      if (managerRole === "TA") {
        if (enrollment.u_role !== "STUDENT") {
          throw new EnrollmentServiceError("Teaching Assistants can only change student roles.", 403);
        }
      }

      if (managerRole === "INSTRUCTOR") {
        if (enrollment.u_role === "INSTRUCTOR") {
          throw new EnrollmentServiceError("Instructors cannot change other instructor roles.", 403);
        }
      }

      enrollment.u_role = change.newRole;
      await enrollment.save();
      updated.push({ u_id: enrollment.u_id, newRole: enrollment.u_role });
    }

    for (const userId of removals) {
      const enrollment = enrollmentMap.get(userId);
      if (!enrollment) {
        throw new EnrollmentServiceError(`Enrollment not found for user ${userId}`);
      }

      if (managerRole === "TA" && enrollment.u_role !== "STUDENT") {
        throw new EnrollmentServiceError("Teaching Assistants can only remove students.", 403);
      }

      if (managerRole !== "INSTRUCTOR" && enrollment.u_role === "INSTRUCTOR") {
        throw new EnrollmentServiceError("You do not have permission to remove this member.", 403);
      }

      await Enrollment.deleteOne({ _id: (enrollment as any)._id });
      removedResults.push(userId);
    }

    return { updated, removed: removedResults };
  }
}
