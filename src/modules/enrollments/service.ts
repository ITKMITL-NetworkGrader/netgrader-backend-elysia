import { Enrollment, IEnrollment } from "./model";
import { Course } from "../courses/model";

export class EnrollmentService {
  static async createEnrollment(u_id: string, u_role: string, c_id: string): Promise<IEnrollment> {
    const courseExists = await Course.exists({ _id: c_id });
    if (!courseExists) {
      throw new Error("Course does not exist.");
    }
    const existingEnrollment = await Enrollment.findOne({ $and: [{ u_id: u_id }, { c_id: c_id }] });
    if (existingEnrollment) {
      throw new Error("Enrollment already exists for this user and course.");
    }
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

  static async getEnrollmentsByCourseId(c_id: string): Promise<IEnrollment[]> {
    const courseExists = await Course.exists({ _id: c_id });
    if (!courseExists) {
      throw new Error("Course does not exist.");
    }
    try {
      const enrollments = await Enrollment.find({ _id: c_id})
      return enrollments;
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
}