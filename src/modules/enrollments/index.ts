import { Elysia, t } from "elysia";
import { EnrollmentService } from "./service";
import { authPlugin } from "../../plugins/plugins";
import { User } from "../auth/model";
import { shortcodeToObjectId } from "../courses/services";

export const enrollmentRoutes = new Elysia({ prefix: "/enrollments" })
  .use(authPlugin)
  .get("/", async ({ set }) => {
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
  },{
    detail: {
      tags: ["Enrollments"],
      summary: "Get All Enrollments",
      description: "Fetch all enrollments in the system.",
    },
  })
  .post(
    "/",
    async ({ body, set, authPlugin }) => {
      const { c_id } = body;
      const u_id = authPlugin?.u_id || "";
      const user = await User.findOne({ u_id: u_id }, "role");
      try {
        const enrollment = await EnrollmentService.createEnrollment(u_id, user?.role || "", shortcodeToObjectId(c_id).toString());
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
      }),
      response: {
        200: t.Object({
          success: t.Boolean(),
          message: t.String(),
          enrollment: t.Object({
            u_id: t.String(),
            c_id: t.String(),
            u_role: t.String(),
            enrollmentDate: t.Date(),
          })}),
        400: t.Object({
          success: t.Boolean(),
            message: t.String(),
        }),
      },
      detail: {
        tags: ["Enrollments"],
        summary: "Create Enrollment",
        description: "Create a new enrollment for a user in a course.",
    }}
  )
  .get(
    "/me",
    async ({ authPlugin, set }) => {
      const { u_id = "" } = authPlugin || {};
      try {
        const enrollments = await EnrollmentService.getEnrollmentsByUserId(u_id);
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
            enrollments: t.Array(t.Optional(
                t.Object({
                u_id: t.String(),
                c_id: t.String(),
                u_role: t.String(),
                enrollmentDate: t.Date(),
                }))
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
        const enrollments = await EnrollmentService.getEnrollmentsByCourseId(shortcodeToObjectId(c_id).toString());
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
            enrollments: t.Array(t.Optional(
                t.Object({
                u_id: t.String(),
                c_id: t.String(),
                u_role: t.String(),
                enrollmentDate: t.Date(),
                })
            )),
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
        await EnrollmentService.deleteEnrollment(u_id, shortcodeToObjectId(c_id).toString());
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
    },
  );