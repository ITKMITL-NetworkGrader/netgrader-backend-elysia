import { Elysia, t } from "elysia";
import { Course } from "./model";
import { Enrollment } from "../enrollments/model";
import { EnrollmentService } from "../enrollments/service";
import { getDateWithTimezone } from "../../utils/helpers.js";
import { env } from "process";
import { authPlugin } from "../../plugins/plugins";
import { objectIdToShortcode, shortcodeToObjectId } from "./services";

const courseBodySchema = t.Object({
  title: t.String(),
  description: t.String(),
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
        const newCourse = new Course(body);
        newCourse.created_by = u_id;
        await newCourse.save();
        set.status = 201;
        return { message: "Course created successfully", course: newCourse };
      } catch (error: any) {
        set.status = 400;
        return { message: "Error creating course", error: error.message };
      }
    },
    {
      body: courseBodySchema,
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
        const courses = await Course.find();
        set.status = 200;
        return { courses: courses.filter(course => course.visibility === "public").map(course => ({ ...course.toObject(), _id: objectIdToShortcode(course._id) })) };
      } catch (error: any) {
        set.status = 500;
        return { message: "Error fetching courses", error: error.message };
      }
    },
    {
      detail: {
        tags: ["Courses"],
        description: "Get all courses",
        summary: "Get all courses",
      },
    }
  )
  .get(
    "/:id",
    async ({ params, set, authPlugin }) => {
      try {
        const { u_id } = authPlugin ?? { u_id: "" };
        const courseId = shortcodeToObjectId(params.id);
        const course = await Course.findById(courseId);
        if (!course) {
          set.status = 404;
          return;
        }
        const enrollment = await EnrollmentService.getUserEnrollmentStatus(courseId.toString(), u_id);
        set.status = 200;
        return { course, ...enrollment };
      } catch (error: any) {
        set.status = 500;
        return { message: "Error fetching course", error: error.message };
      }
    },
    {
      params: t.Object({ id: t.String() }),
      detail: {
        tags: ["Courses"],
        description: "Get a single course by its ID",
        summary: "Get a single course by its ID",
      },
    }
  )
  .put(
    "/:id",
    async ({ params, body, set }) => {
      const now = getDateWithTimezone(env.TIMEZONE_OFFSET ? parseInt(env.TIMEZONE_OFFSET) : 7)
      body.updatedAt = now;
      try {
        const updatedCourse = await Course.findByIdAndUpdate(shortcodeToObjectId(params.id), body, {
          new: true,
          runValidators: true,
        });
        if (!updatedCourse) {
          set.status = 404;
          return { message: "Course not found" };
        }
        set.status = 200;
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
        const deletedCourse = await Course.findByIdAndDelete(shortcodeToObjectId(params?.id));
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
      detail: {
        tags: ["Courses"],
        description: "Delete a course by its ID",
        summary: "Delete a course by its ID",
      },
    }
  )
  // Nested route to get all enrollments for a specific course
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
      detail: { summary: "Get all enrollments for a specific course" },
    }
  );
