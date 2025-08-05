import { Enrollment, IEnrollment } from "./model";
import { Course, ICourse } from "../courses/model";

interface CourseMember {
  u_id: string;
  fullName: string;
  u_role: "INSTRUCTOR" | "STUDENT" | "TA";
  enrollmentDate: Date;
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
    if (course.password && course.password.trim() !== "") {
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
        },
      },
    ]);
    return members as CourseMember[];
  }
}
