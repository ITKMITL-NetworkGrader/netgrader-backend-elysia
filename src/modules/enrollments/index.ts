import { Elysia, t } from "elysia";
import { EnrollmentService } from "./service";
import { authPlugin } from "../../plugins/plugins";
import { User } from "../auth/model";
import { ObjectId } from "mongodb";

export const enrollmentRoutes = new Elysia({ prefix: "/enrollments" })
  .use(authPlugin)
  .get(
    "/",
    async ({ set }) => {
      try {
        const enrollments = await EnrollmentService.getAllEnrollments();
        set.status = 200;
        return {
          success: true,
          message: "Enrollments fetched successfully.",
          enrollments,
        };
      } catch (error) {
        set.status = 400;
        return {
          success: false,
          message: (error as Error).message,
        };
      }
    },
    {
      detail: {
        tags: ["Enrollments"],
        summary: "Get All Enrollments",
        description: "Fetch all enrollments in the system.",
      },
    }
  )
  .post(
    "/",
    async ({ body, set, authPlugin }) => {
      const { c_id } = body;
      const { u_id } = authPlugin ?? { u_id: "" };
      const user = await User.findOne({ u_id }, "role");

      if (!user) {
        set.status = 401;
        return {
          success: false,
          message: "User not found.",
        };
      }

      let enrollmentRole: string;

      // If user is ADMIN, they MUST specify a role
      if (user.role === "ADMIN") {
        if (!body.role) {
          set.status = 400;
          return {
            success: false,
            message: "Admin must specify a role to enroll in the course.",
          };
        }
        enrollmentRole = body.role;
      } else {
        // If user is not ADMIN, they CANNOT specify a role - use their default role
        if (body.role) {
          set.status = 403;
          return {
            success: false,
            message: "Only admins can specify enrollment roles.",
          };
        }
        enrollmentRole = user.role;
      }

      try {
        const enrollment = await EnrollmentService.createEnrollment(
          u_id,
          enrollmentRole,
          new ObjectId(c_id).toString(),
          body.password ?? undefined
        );
        set.status = 201;
        return {
          success: true,
          message: "Enrollment created successfully.",
          enrollment,
        };
      } catch (error) {
        set.status = 400;
        return {
          success: false,
          message: (error as Error).message,
        };
      }
    },
    {
      body: t.Object({
        c_id: t.String(),
        password: t.Optional(t.String()),
        role: t.Optional(t.String()),
      }),
      response: {
        201: t.Object({
          success: t.Boolean(),
          message: t.String(),
          enrollment: t.Object({
            u_id: t.String(),
            c_id: t.String(),
            u_role: t.String(),
            enrollmentDate: t.Date(),
          }),
        }),
        400: t.Object({
          success: t.Boolean(),
          message: t.String(),
        }),
        401: t.Object({
          success: t.Boolean(),
          message: t.String(),
        }),
        403: t.Object({
          success: t.Boolean(),
          message: t.String(),
        }),
      },
      detail: {
        tags: ["Enrollments"],
        summary: "Create Enrollment",
        description: "Create a new enrollment for a user in a course.",
      },
    }
  )
  .get(
    "/me",
    async ({ authPlugin, set }) => {
      const { u_id = "" } = authPlugin || {};
      try {
        const enrollments = await EnrollmentService.getEnrollmentsByUserId(
          u_id
        );
        set.status = 200;
        if (enrollments.length === 0) {
          return {
            success: true,
            message: "No enrollments found for this user.",
            enrollments: [],
          };
        }
        return {
          success: true,
          message: "Enrollments fetched successfully.",
          enrollments,
        };
      } catch (error) {
        return {
          success: false,
          message: (error as Error).message,
        };
      }
    },
    {
      response: {
        200: t.Object({
          success: t.Boolean(),
          message: t.String(),
          enrollments: t.Array(
            t.Optional(
              t.Object({
                u_id: t.String(),
                c_id: t.String(),
                u_role: t.String(),
                enrollmentDate: t.Date(),
              })
            )
          ),
        }),
        400: t.Object({
          success: t.Boolean(),
          message: t.String(),
        }),
      },
      detail: {
        tags: ["Enrollments"],
        summary: "Get User Enrollments",
        description: "Fetch all enrollments for the authenticated user.",
      },
    }
  )
  .get(
    "/:c_id",
    async ({ params }) => {
      const { c_id } = params;
      try {
        const enrollments = await EnrollmentService.getEnrollmentsByCourseId(
          new ObjectId(c_id).toString()
        );
        return {
          success: true,
          enrollments,
        };
      } catch (error) {
        return {
          success: false,
          message: (error as Error).message,
        };
      }
    },
    {
      params: t.Object({
        c_id: t.String(),
      }),
      response: {
        200: t.Object({
          success: t.Boolean(),
          enrollments: t.Array(
            t.Optional(
              t.Object({
                u_id: t.String(),
                fullName: t.String(),
                u_role: t.String(),
                enrollmentDate: t.Date(),
              })
            )
          ),
        }),
        400: t.Object({
          success: t.Boolean(),
          message: t.String(),
        }),
      },
      detail: {
        tags: ["Enrollments"],
        summary: "Get Course Enrollments",
        description: "Fetch all enrollments for a specific course.",
      },
    }
  )
  .delete(
    "/",
    async ({ body, set, authPlugin }) => {
      const { c_id } = body;
      const { u_id = "" } = authPlugin || {};
      try {
        await EnrollmentService.deleteEnrollment(
          u_id,
          new ObjectId(c_id).toString()
        );
        set.status = 200; // No Content
        return { success: true, message: "Enrollment deleted successfully." };
      } catch (error) {
        set.status = 400;
        return { success: false, message: (error as Error).message };
      }
    },
    {
      body: t.Object({
        c_id: t.String(),
      }),
      response: {
        204: t.Object({
          success: t.Boolean(),
          message: t.String(),
        }),
        400: t.Object({
          success: t.Boolean(),
          message: t.String(),
        }),
      },
      detail: {
        tags: ["Enrollments"],
        summary: "Delete Enrollment",
        description: "Delete an enrollment for a user in a course.",
      },
    }
  )
  // ...existing code...
  .get(
    "/status/:c_id",
    async ({ params, authPlugin, set }) => {
      try {
        const { u_id = "" } = authPlugin || {};
        const { c_id } = params;

        const courseId = new ObjectId(c_id).toString();
        const enrollment = await EnrollmentService.getUserEnrollmentStatus(
          courseId,
          u_id
        );

        set.status = 200;
        return {
          success: true,
          enrollment: {
            isEnrolled: enrollment.isEnrolled,
            role: enrollment.role,
            enrollmentDate: enrollment.enrollmentDate,
          },
        };
      } catch (error) {
        set.status = 400;
        return {
          success: false,
          message: (error as Error).message,
        };
      }
    },
    {
      params: t.Object({
        c_id: t.String(),
      }),
      response: {
        200: t.Object({
          success: t.Boolean(),
          enrollment: t.Object({
            isEnrolled: t.Boolean(),
            role: t.Optional(t.String()),
            enrollmentDate: t.Optional(t.Date()),
          }),
        }),
        400: t.Object({
          success: t.Boolean(),
          message: t.String(),
        }),
      },
      detail: {
        tags: ["Enrollments"],
        summary: "Get User Enrollment Status",
        description:
          "Get the current user's enrollment status and role for a specific course.",
      },
    }
  );
