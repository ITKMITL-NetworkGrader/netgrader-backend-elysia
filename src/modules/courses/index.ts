import { Elysia, t } from "elysia";
import { Course } from "./model";
import { Enrollment } from "../enrollments/model";
import { EnrollmentService } from "../enrollments/service";
import { getDateWithTimezone } from "../../utils/helpers.js";
import { env } from "process";
import { authPlugin, requireRole } from "../../plugins/plugins";
import { objectIdToShortcode, shortcodeToObjectId } from "./services";

const courseBodySchema = t.Object({
  title: t.String(),
  description: t.String(),
  password: t.Optional(t.String()),
  visibility: t.Union([t.Literal("public"), t.Literal("private")]),
  createdAt: t.Optional(t.Date()),
  updatedAt: t.Optional(t.Date()),
});

export const courseRoutes = new Elysia({ prefix: "/courses" })
  .use(authPlugin)
  .post(
    "/",
    async ({ body, set, authPlugin }) => {
      try {
        const { u_id } = authPlugin ?? { u_id: "" };
        const newCourse = new Course({
          ...body,
          created_by: u_id
        });
        
        const savedCourse = await newCourse.save();
        
        const enrollment = await EnrollmentService.createEnrollment(
          u_id, 
          "INSTRUCTOR", 
          savedCourse._id.toString(),
          body.password ?? undefined
        );
        
        if (!enrollment) {
          set.status = 400;
          return { message: "Failed to create enrollment for the instructor." };
        }

        set.status = 201;
        return { 
          message: "Course created successfully", 
          course: savedCourse 
        };
      } catch (error: any) {
        set.status = 400;
        return { message: "Error creating course", error: error.message };
      }
    },
    {
      body: courseBodySchema,
      beforeHandle: requireRole(["ADMIN", "INSTRUCTOR"]),
      detail: {
        tags: ["Courses"],
        description: "Create a new course",
        summary: "Create a new course",
      },
    }
  )
  .get(
    "/",
    async ({ set }) => {
      try {
        const courses = await Course.find({ visibility: "public" }).select("+password");
        
        set.status = 200;
        return { 
          courses: courses.map(course => ({
            ...course.toObject(),
            _id: objectIdToShortcode(course._id),
            requiresPassword: !!(course.password && course.password.trim() !== ''),
            password: undefined
          }))
        };
      } catch (error: any) {
        set.status = 500;
        return { message: "Error fetching courses", error: error.message };
      }
    },
    {
      detail: {
        tags: ["Courses"],
        description: "Get all public courses",
        summary: "Get all public courses",
      },
    }
  )
  .get(
    "/:id",
    async ({ params, set, authPlugin }) => {
      try {
        const { u_id } = authPlugin ?? { u_id: "" };
        const courseId = shortcodeToObjectId(params.id);
        
        // Find course and include password field to check if it exists
        const course = await Course.findById(courseId).select('+password');
        if (!course) {
          set.status = 404;
          return { message: "Course not found" };
        }
        
        const enrollment = await EnrollmentService.getUserEnrollmentStatus(
          courseId.toString(), 
          u_id
        );
        
        // Create course object without exposing the actual password
        const courseData = {
          ...course.toObject(),
          _id: objectIdToShortcode(course._id),
          requiresPassword: !!(course.password && course.password.trim() !== ''),
          password: undefined // Remove password from response
        };
        
        return { 
          course: courseData, 
          enrollment: {
            isEnrolled: enrollment.isEnrolled,
            role: enrollment.role,
            enrollmentDate: enrollment.enrollmentDate
          }
        };
      } catch (error: any) {
        set.status = 500;
        return { message: "Error fetching course", error: error.message };
      }
    },
    {
      params: t.Object({ id: t.String() }),
      response: {
        200: t.Object({
          course: t.Object({
            _id: t.String(),
            title: t.String(),
            description: t.String(),
            visibility: t.Union([t.Literal("public"), t.Literal("private")]),
            created_by: t.String(),
            createdAt: t.Date(),
            updatedAt: t.Date(),
            requiresPassword: t.Boolean()
          }),
          enrollment: t.Object({
            isEnrolled: t.Boolean(),
            role: t.Optional(t.String()),
            enrollmentDate: t.Optional(t.Date())
          })
        }),
        404: t.Object({
          message: t.String()
        }),
        500: t.Object({
          message: t.String(),
          error: t.Optional(t.String())
        })
      },
      detail: {
        tags: ["Courses"],
        description: "Get a single course by its ID with enrollment status",
        summary: "Get a single course by its ID",
      },
    }
  )
  .put(
    "/:id",
    async ({ params, body, set }) => {
      try {
        const now = getDateWithTimezone(
          env.TIMEZONE_OFFSET ? parseInt(env.TIMEZONE_OFFSET) : 7
        );
        
        const updatedCourse = await Course.findByIdAndUpdate(
          shortcodeToObjectId(params.id),
          { ...body, updatedAt: now },
          { new: true, runValidators: true }
        );
        
        if (!updatedCourse) {
          set.status = 404;
          return { message: "Course not found" };
        }
        
        return {
          message: "Course updated successfully",
          course: updatedCourse,
        };
      } catch (error: any) {
        set.status = 400;
        return { message: "Error updating course", error: error.message };
      }
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Partial(courseBodySchema),
      beforeHandle: requireRole(["ADMIN", "INSTRUCTOR"]),
      detail: {
        tags: ["Courses"],
        description: "Update a course by its ID (partial update supported)",
        summary: "Update a course by its ID",
      },
    }
  )
  .delete(
    "/:id",
    async ({ params, set }) => {
      try {
        const courseId = shortcodeToObjectId(params.id);
        const deletedCourse = await Course.findByIdAndDelete(courseId);
        
        if (!deletedCourse) {
          set.status = 404;
          return { message: "Course not found" };
        }
        
        await Enrollment.deleteMany({ courseId: params.id });
        
        return {
          message: "Course and related enrollments deleted successfully",
        };
      } catch (error: any) {
        set.status = 500;
        return { message: "Error deleting course", error: error.message };
      }
    },
    {
      params: t.Object({ id: t.String() }),
      beforeHandle: requireRole(["ADMIN", "INSTRUCTOR"]),
      detail: {
        tags: ["Courses"],
        description: "Delete a course by its ID",
        summary: "Delete a course by its ID",
      },
    }
  )
  .get(
    "/:id/enrollments",
    async ({ params, set }) => {
      try {
        const enrollments = await Enrollment.find({
          courseId: params.id,
        }).populate("courseId");
        
        if (!enrollments.length) {
          set.status = 404;
          return { message: "No enrollments found for this course" };
        }
        
        return { enrollments };
      } catch (error: any) {
        set.status = 500;
        return { message: "Error fetching enrollments", error: error.message };
      }
    },
    {
      params: t.Object({ id: t.String() }),
      detail: {
        tags: ["Courses"],
        description: "Get all enrollments for a specific course",
        summary: "Get all enrollments for a specific course"
      },
    }
  );
