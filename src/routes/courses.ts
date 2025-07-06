import { Elysia, t } from "elysia";
import { Course } from "../models/Course";
import { Enrollment } from "../models/Enrollment";
import { getDateWithTimezone } from "../utils/helpers.js";
import { env } from "process";


const courseBodySchema = t.Object({
  title: t.String(),
  description: t.String(),
  instructor: t.String(),
  createdAt: t.Optional(t.Date()),
  updatedAt: t.Optional(t.Date()),
});

export const courseRoutes = new Elysia({ prefix: "/courses" })
  .post(
    "/",
    async ({ body, set }) => {
      try {
        const newCourse = new Course(body);
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
        return { courses };
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
    async ({ params, set }) => {
      try {
        const course = await Course.findById(params.id);
        if (!course) {
          set.status = 404;
          return;
        }
        set.status = 200;
        return { course };
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
        const updatedCourse = await Course.findByIdAndUpdate(params.id, body, {
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
        const deletedCourse = await Course.findByIdAndDelete(params?.id);
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
