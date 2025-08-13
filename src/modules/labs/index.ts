import { Elysia, t } from "elysia";
import { LabModel } from "./model";
import { LabService } from "./service";
import { authPlugin, requireRole } from "../../plugins/plugins";
import { getDateWithTimezone } from "../../utils/helpers";
import { env } from "process";

// Define schemas for validation matching the new model interface
const TestCaseSchema = t.Object({
  description: t.Optional(t.String()),
  comparison_type: t.Union([
    t.Literal('equals'),
    t.Literal('contains'), 
    t.Literal('regex'),
    t.Literal('range'),
    t.Literal('exists'),
    t.Literal('not_exists'),
    t.Literal('count'),
    t.Literal('success'),
    t.Literal('ssh_success'),
    t.Literal('greater_than'),
    t.Literal('less_than')
  ]),
  expected_result: t.Any()
});

const AnsibleTaskSchema = t.Object({
  task_id: t.Optional(t.String()),
  name: t.String(),
  template_name: t.String(),
  parameters: t.Optional(t.Record(t.String(), t.Any())),
  test_cases: t.Array(TestCaseSchema),
  points: t.Number({ minimum: 0 })
});

const PlaySchema = t.Object({
  play_id: t.Optional(t.String()),
  source_device: t.String(),
  target_device: t.String(),
  ansible_tasks: t.Array(AnsibleTaskSchema, { default: [] })
});

const IpVariableMappingSchema = t.Object({
  name: t.String(),
  hostOffset: t.Number(),
  example: t.Optional(t.String())
});

const IpConfigSchema = t.Object({
  scope: t.Union([t.Literal("lab"), t.Literal("part")]),
  baseNetwork: t.String(),
  subnetMask: t.Number(),
  allocationStrategy: t.Union([t.Literal("group_based"), t.Literal("student_id_based")]),
  reservedSubnets: t.Optional(t.Array(t.String())),
  variablesMapping: t.Array(IpVariableMappingSchema)
});

const DeviceIpMappingSchema = t.Object({
  deviceId: t.String(),
  ipVariable: t.String()
});

const DeviceCredentialsSchema = t.Object({
  ansible_user: t.String(),
  ansible_password: t.String()
});

const DeviceSchema = t.Object({
  id: t.String(),
  ip_address: t.String(),
  ansible_connection: t.String(),
  credentials: DeviceCredentialsSchema,
  platform: t.Optional(t.Union([t.String(), t.Null()])),
  jump_host: t.Optional(t.Union([t.String(), t.Null()])),
  ssh_args: t.Optional(t.Union([t.String(), t.Null()])),
  use_persistent_connection: t.Boolean()
});

const LabPartSchema = t.Object({
  part_id: t.Optional(t.String()), // Make optional for auto-generation
  title: t.String(),
  textMd: t.String(),
  order: t.Number(),
  total_points: t.Number(),
  ipSchema: t.Optional(IpConfigSchema),
  play: PlaySchema
});

const LabBodySchema = t.Object({
  title: t.String(),
  type: t.Union([t.Literal("lab"), t.Literal("exam")]),
  description: t.String(),
  courseId: t.String(),
  groupsRequired: t.Boolean(),
  ipSchema: t.Optional(IpConfigSchema),
  deviceIpMapping: t.Optional(t.Array(DeviceIpMappingSchema)),
  devices: t.Optional(t.Array(DeviceSchema)),
  parts: t.Array(LabPartSchema)
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
        type: t.Optional(t.Union([t.Literal("lab"), t.Literal("exam")])),
        page: t.Optional(t.String()),
        limit: t.Optional(t.String())
      }),
      detail: {
        tags: ["Labs"],
        summary: "Get All Labs",
        description: "Fetch all labs with optional filtering and pagination"
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
        summary: "Get Lab by ID",
        description: "Fetch a specific lab by its ID"
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
        summary: "Create Lab",
        description: "Create a new lab with the specified details (part_id, play_id, and task_id are auto-generated if not provided)"
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
        summary: "Update Lab",
        description: "Update a lab by its ID (partial updates supported)"
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
        summary: "Delete Lab",
        description: "Delete a lab by its ID"
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
        summary: "Get Labs by Course",
        description: "Fetch all labs for a specific course"
      }
    }
  )

  // Add part to lab
  .post(
    "/:id/parts",
    async ({ params, body, set }) => {
      try {
        const updatedLab = await LabService.addPartToLab(params.id, body);

        if (!updatedLab) {
          set.status = 404;
          return {
            success: false,
            message: "Lab not found"
          };
        }

        set.status = 201;
        return {
          success: true,
          message: "Lab part added successfully",
          data: updatedLab
        };
      } catch (error) {
        set.status = 400;
        return {
          success: false,
          message: "Error adding lab part",
          error: (error as Error).message
        };
      }
    },
    {
      params: t.Object({ id: t.String() }),
      body: LabPartSchema,
      beforeHandle: requireRole(["ADMIN", "INSTRUCTOR"]),
      detail: {
        tags: ["Labs"],
        summary: "Add Lab Part",
        description: "Add a new part to an existing lab (part_id, play_id, and task_id are auto-generated if not provided)"
      }
    }
  )

  // Update specific lab part
  .put(
    "/:id/parts/:partId",
    async ({ params, body, set }) => {
      try {
        const result = await LabService.updateLabPart(params.id, params.partId, body);

        if (result.error) {
          set.status = 404;
          return {
            success: false,
            message: result.error
          };
        }

        set.status = 200;
        return {
          success: true,
          message: "Lab part updated successfully",
          data: result.lab
        };
      } catch (error) {
        set.status = 400;
        return {
          success: false,
          message: "Error updating lab part",
          error: (error as Error).message
        };
      }
    },
    {
      params: t.Object({ 
        id: t.String(),
        partId: t.String()
      }),
      body: t.Partial(LabPartSchema),
      beforeHandle: requireRole(["ADMIN", "INSTRUCTOR"]),
      detail: {
        tags: ["Labs"],
        summary: "Update Lab Part",
        description: "Update a specific part of a lab"
      }
    }
  )

  // Delete lab part
  .delete(
    "/:id/parts/:partId",
    async ({ params, set }) => {
      try {
        const result = await LabService.deleteLabPart(params.id, params.partId);

        if (result.error) {
          set.status = 404;
          return {
            success: false,
            message: result.error
          };
        }

        set.status = 200;
        return {
          success: true,
          message: "Lab part deleted successfully",
          data: result.lab
        };
      } catch (error) {
        set.status = 500;
        return {
          success: false,
          message: "Error deleting lab part",
          error: (error as Error).message
        };
      }
    },
    {
      params: t.Object({
        id: t.String(),
        partId: t.String()
      }),
      beforeHandle: requireRole(["ADMIN", "INSTRUCTOR"]),
      detail: {
        tags: ["Labs"],
        summary: "Delete Lab Part",
        description: "Delete a specific part from a lab"
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
        summary: "Get Lab Statistics",
        description: "Get overview statistics for labs"
      }
    }
  );