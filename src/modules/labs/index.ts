import { Elysia, t } from "elysia";
import { LabService } from "./service";
import { authPlugin, requireRole } from "../../plugins/plugins";
import { IpAllocationService } from "../../services/ip-allocation";

// Updated schemas for the embedded network model
const LabBodySchema = t.Object({
  courseId: t.String(),
  title: t.String(),
  description: t.Optional(t.String()),
  type: t.Optional(t.Union([t.Literal("lab"), t.Literal("exam")])),
  network: t.Object({
    name: t.String(),
    topology: t.Object({
      baseNetwork: t.String(),
      subnetMask: t.Number(),
      allocationStrategy: t.Union([t.Literal("student_id_based"), t.Literal("group_based")])
    }),
    devices: t.Array(t.Object({
      deviceId: t.String(),
      templateId: t.String(),
      displayName: t.String(),
      ipVariables: t.Array(t.Object({
        name: t.String(),
        hostOffset: t.Number(),
        interface: t.Optional(t.String())
      })),
      credentials: t.Object({
        usernameTemplate: t.String(),
        passwordTemplate: t.String(),
        enablePassword: t.Optional(t.String())
      })
    }))
  }),
  publishedAt: t.Optional(t.Date()),
  dueDate: t.Optional(t.Date())
});

export const labRoutes = new Elysia({ prefix: "/labs" })
  .use(authPlugin)
  
  // Get all labs
  .get(
    "/",
    async ({ set, query }) => {
      try {
        const { courseId, createdBy, type, page = "1", limit = "10" } = query;
        const pageNum = parseInt(page as string);
        const limitNum = parseInt(limit as string);

        const result = await LabService.getLabs({
          courseId,
          createdBy,
          type,
          page: pageNum,
          limit: limitNum
        });

        set.status = 200;
        return {
          success: true,
          message: "Labs fetched successfully",
          data: result
        };
      } catch (error) {
        set.status = 500;
        return { 
          success: false, 
          message: "Error fetching labs",
          error: (error as Error).message 
        };
      }
    },
    {
      query: t.Object({
        courseId: t.Optional(t.String()),
        createdBy: t.Optional(t.String()),
        type: t.Optional(t.String()),
        page: t.Optional(t.String()),
        limit: t.Optional(t.String())
      }),
      detail: {
        tags: ["Labs"],
        summary: "Get All Labs"
      }
    }
  )

  // Create new lab
  .post(
    "/",
    async ({ body, set, authPlugin }) => {
      try {
        const { u_id } = authPlugin ?? { u_id: "" };
        
        const savedLab = await LabService.createLab(body, u_id);

        set.status = 201;
        return {
          success: true,
          message: "Lab created successfully",
          data: savedLab
        };
      } catch (error) {
        set.status = 400;
        return {
          success: false,
          message: "Error creating lab",
          error: (error as Error).message
        };
      }
    },
    {
      body: LabBodySchema,
      beforeHandle: requireRole(["ADMIN", "INSTRUCTOR"]),
      detail: {
        tags: ["Labs"],
        summary: "Create Lab"
      }
    }
  )

  // Get lab by ID
  .get(
    "/:id",
    async ({ params, set }) => {
      try {
        const lab = await LabService.getLabById(params.id);
        
        if (!lab) {
          set.status = 404;
          return {
            success: false,
            message: "Lab not found"
          };
        }

        set.status = 200;
        return {
          success: true,
          message: "Lab fetched successfully",
          data: lab
        };
      } catch (error) {
        set.status = 500;
        return {
          success: false,
          message: "Error fetching lab",
          error: (error as Error).message
        };
      }
    },
    {
      params: t.Object({ id: t.String() }),
      detail: {
        tags: ["Labs"],
        summary: "Get Lab by ID"
      }
    }
  )

  // Update lab
  .put(
    "/:id",
    async ({ params, body, set }) => {
      try {
        const updatedLab = await LabService.updateLab(params.id, body);

        if (!updatedLab) {
          set.status = 404;
          return {
            success: false,
            message: "Lab not found"
          };
        }

        set.status = 200;
        return {
          success: true,
          message: "Lab updated successfully",
          data: updatedLab
        };
      } catch (error) {
        set.status = 400;
        return {
          success: false,
          message: "Error updating lab",
          error: (error as Error).message
        };
      }
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Partial(LabBodySchema),
      beforeHandle: requireRole(["ADMIN", "INSTRUCTOR"]),
      detail: {
        tags: ["Labs"],
        summary: "Update Lab"
      }
    }
  )

  // Delete lab
  .delete(
    "/:id",
    async ({ params, set }) => {
      try {
        const deletedLab = await LabService.deleteLab(params.id);

        if (!deletedLab) {
          set.status = 404;
          return {
            success: false,
            message: "Lab not found"
          };
        }

        set.status = 200;
        return {
          success: true,
          message: "Lab deleted successfully",
          data: deletedLab
        };
      } catch (error) {
        set.status = 500;
        return {
          success: false,
          message: "Error deleting lab",
          error: (error as Error).message
        };
      }
    },
    {
      params: t.Object({ id: t.String() }),
      beforeHandle: requireRole(["ADMIN", "INSTRUCTOR"]),
      detail: {
        tags: ["Labs"],
        summary: "Delete Lab"
      }
    }
  )

  // Get labs by course
  .get(
    "/course/:courseId",
    async ({ params, set, query }) => {
      try {
        const { page = "1", limit = "10" } = query;
        const pageNum = parseInt(page as string);
        const limitNum = parseInt(limit as string);

        const result = await LabService.getLabsByCourse(params.courseId, pageNum, limitNum);

        set.status = 200;
        return {
          success: true,
          message: "Labs fetched successfully",
          data: result
        };
      } catch (error) {
        set.status = 500;
        return {
          success: false,
          message: "Error fetching labs for course",
          error: (error as Error).message
        };
      }
    },
    {
      params: t.Object({ courseId: t.String() }),
      query: t.Object({
        page: t.Optional(t.String()),
        limit: t.Optional(t.String())
      }),
      detail: {
        tags: ["Labs"],
        summary: "Get Labs by Course"
      }
    }
  )

  // Get lab with full details including network
  .get(
    "/:id/details",
    async ({ params, set }) => {
      try {
        const lab = await LabService.getLabWithDetails(params.id);
        
        if (!lab) {
          set.status = 404;
          return {
            success: false,
            message: "Lab not found"
          };
        }

        set.status = 200;
        return {
          success: true,
          message: "Lab details fetched successfully",
          data: lab
        };
      } catch (error) {
        set.status = 500;
        return {
          success: false,
          message: "Error fetching lab details",
          error: (error as Error).message
        };
      }
    },
    {
      params: t.Object({ id: t.String() }),
      detail: {
        tags: ["Labs"],
        summary: "Get Lab with Full Details",
        description: "Get lab with populated network information"
      }
    }
  )

  // Get lab statistics
  .get(
    "/stats/overview",
    async ({ set, query }) => {
      try {
        const { courseId } = query;
        
        const stats = await LabService.getLabStatistics(courseId);

        set.status = 200;
        return {
          success: true,
          message: "Lab statistics fetched successfully",
          data: stats
        };
      } catch (error) {
        set.status = 500;
        return {
          success: false,
          message: "Error fetching lab statistics",
          error: (error as Error).message
        };
      }
    },
    {
      query: t.Object({
        courseId: t.Optional(t.String())
      }),
      detail: {
        tags: ["Labs"],
        summary: "Get Lab Statistics"
      }
    }
  )

  // Get IP assignments for a student in a lab
  .get(
    "/:id/ip-assignments/:studentId",
    async ({ params, set }) => {
      try {
        const lab = await LabService.getLabById(params.id);
        
        if (!lab) {
          set.status = 404;
          return {
            success: false,
            message: "Lab not found"
          };
        }

        const ipAssignments = await IpAllocationService.calculateStudentIPs(lab as any, params.studentId as any);
        
        set.status = 200;
        return {
          success: true,
          message: "IP assignments calculated successfully",
          data: ipAssignments
        };
      } catch (error) {
        set.status = 500;
        return {
          success: false,
          message: "Error calculating IP assignments",
          error: (error as Error).message
        };
      }
    },
    {
      params: t.Object({ 
        id: t.String(),
        studentId: t.String()
      }),
      detail: {
        tags: ["Labs"],
        summary: "Get IP Assignments for Student",
        description: "Calculate IP assignments for a specific student in a lab"
      }
    }
  );
