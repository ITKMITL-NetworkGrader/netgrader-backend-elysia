import { Enrollment, enrollmentBody } from "./model";
import { Course } from "../courses/model";
import { status, t } from "elysia";

export const createEnrollment = async ( body: enrollmentBody) => {
  try {
    const course = await Course.findById(body.courseId);
    if (!course) {
      throw status(404, { message: 'Course not found' });
    }
    
    const existingEnrollment = await Enrollment.findOne({ 
        courseId: body.courseId, 
        studentId: body.studentId 
    });

    if (existingEnrollment) {
      throw status(409, { message: 'Student is already enrolled in this course' });
    }

    const newEnrollment = new Enrollment(body);
    await newEnrollment.save();

    status(201);
    return { message: 'Enrollment successful', enrollment: newEnrollment };

  } catch (error: any) {
    throw status(400, { message: 'Error creating enrollment', error: error.message });
  }
};

export const getEnrollmentsByCourse = async (courseId: string) => {
  try {
    const enrollments = await Enrollment.find({ courseId: courseId }).populate('courseId');
    if (!enrollments.length) {
      throw status(404, { message: 'No enrollments found for this course' });
    }
    return { enrollments };
  } catch (error: any) {
    throw status(500, { message: 'Error fetching enrollments', error: error.message });
  }
};

export const cancelEnrollment = async (id: string) => {
  try {
    const deletedEnrollment = await Enrollment.findByIdAndDelete(id);
    if (!deletedEnrollment) {
      throw status(404, { message: 'Enrollment not found' });
    }
    return { message: 'Enrollment cancelled successfully' };
  } catch (error: any) {
    throw status(500, { message: 'Error cancelling enrollment', error: error.message });
  }
};