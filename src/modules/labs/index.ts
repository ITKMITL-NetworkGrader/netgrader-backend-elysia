import { Elysia, t } from "elysia";
import { LabService } from "./service";
import { authPlugin, requireRole } from "../../plugins/plugins";

// Simple schemas
const LabBodySchema = t.Object({
  title: t.String(),
  type: t.String(),
  description: t.String(),
  courseId: t.String(),
  groupsRequired: t.Boolean(),
  ipSchema: t.Optional(t.Any()),
  deviceIpMapping: t.Optional(t.Any()),
  devices: t.Optional(t.Any()),
  parts: t.Array(t.Any())
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
  );
