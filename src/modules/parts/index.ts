import { Elysia, t } from "elysia";
import { PartService } from "./service";
import { authPlugin, requireRole } from "../../plugins/plugins";

// Updated schemas for embedded tasks model
const PartCreateSchema = t.Object({
  labId: t.String({ description: "Lab ID this part belongs to" }),
  partId: t.String({ description: "Human-readable ID within lab" }),
  title: t.String({ description: "Part title" }),
  description: t.Optional(t.String({ description: "Part description in Markdown" })),
  instructions: t.String({ description: "Student instructions in Markdown" }),
  order: t.Number({ description: "Part order within lab" }),
  tasks: t.Array(t.Object({
    taskId: t.String(),
    name: t.String(),
    description: t.Optional(t.String()),
    templateId: t.String(),
    executionDevice: t.String(),
    targetDevices: t.Array(t.String()),
    parameters: t.Record(t.String(), t.Any()),
    testCases: t.Array(t.Object({
      name: t.String(),
      condition: t.String(),
      points: t.Number(),
      weight: t.Number(),
      timeoutSeconds: t.Number()
    })),
    order: t.Number(),
    points: t.Number()
  })),
  task_groups: t.Array(t.Object({
    group_id: t.String(),
    title: t.String(),
    description: t.Optional(t.String()),
    group_type: t.Union([t.Literal("all_or_nothing"), t.Literal("proportional")]),
    points: t.Number(),
    continue_on_failure: t.Boolean(),
    timeout_seconds: t.Number()
  })),
  prerequisites: t.Optional(t.Array(t.String(), { description: "Array of prerequisite part IDs" })),
  totalPoints: t.Number({ description: "Total points for this part" })
});

const PartUpdateSchema = t.Object({
  partId: t.Optional(t.String()),
  title: t.Optional(t.String()),
  description: t.Optional(t.String()),
  instructions: t.Optional(t.String()),
  order: t.Optional(t.Number()),
  tasks: t.Optional(t.Array(t.Object({
    taskId: t.String(),
    name: t.String(),
    description: t.Optional(t.String()),
    templateId: t.String(),
    executionDevice: t.String(),
    targetDevices: t.Array(t.String()),
    parameters: t.Record(t.String(), t.Any()),
    testCases: t.Array(t.Object({
      name: t.String(),
      condition: t.String(),
      points: t.Number(),
      weight: t.Number(),
      timeoutSeconds: t.Number()
    })),
    order: t.Number(),
    points: t.Number()
  }))),
  task_groups: t.Optional(t.Array(t.Object({
    group_id: t.String(),
    title: t.String(),
    description: t.Optional(t.String()),
    group_type: t.Union([t.Literal("all_or_nothing"), t.Literal("proportional")]),
    points: t.Number(),
    continue_on_failure: t.Boolean(),
    timeout_seconds: t.Number()
  }))),
  prerequisites: t.Optional(t.Array(t.String())),
  totalPoints: t.Optional(t.Number())
});

export const partRoutes = new Elysia({ prefix: "/parts" })
  .use(authPlugin)
  
  // Get all parts with filtering
  .get(
    "/",
    async ({ query, set }) => {
      try {
        const { labId, createdBy, page, limit } = query;
        const filters = {
          labId,
          createdBy,
          page: page ? parseInt(page) : undefined,
          limit: limit ? parseInt(limit) : undefined
        };

        const result = await PartService.getAllParts(filters);
        set.status = 200;
        return result;
      } catch (error) {
        set.status = 500;
        return { error: (error as Error).message };
      }
    },
    {
      query: t.Object({
        labId: t.Optional(t.String({ description: "Filter by lab ID" })),
        createdBy: t.Optional(t.String({ description: "Filter by creator" })),
        page: t.Optional(t.String({ description: "Page number" })),
        limit: t.Optional(t.String({ description: "Items per page" }))
      }),
      response: {
        500: t.Object({ error: t.String() })
      },
      detail: {
        tags: ["Parts"],
        summary: "Get all parts",
        description: "Retrieve all lab parts with optional filtering and pagination"
      }
    }
  )

  // Create new part
  .post(
    "/",
    async ({ body, authPlugin, set }) => {
      try {
        const { u_id } = authPlugin ?? { u_id: "" };

        const newPart = await PartService.createPart(body, u_id);
        set.status = 201;
        return newPart;
      } catch (error) {
        set.status = 400;
        return { error: (error as Error).message };
      }
    },
    {
      body: PartCreateSchema,
      response: {
        400: t.Object({ error: t.String() }),
        401: t.Object({ error: t.String() })
      },
      detail: {
        tags: ["Parts"],
        summary: "Create new part",
        description: "Create a new lab part"
      }
    }
  )

  // Get part by ID
  .get(
    "/:id",
    async ({ params, set }) => {
      try {
        const part = await PartService.getPartById(params.id);
        
        if (!part) {
          set.status = 404;
          return { error: "Part not found" };
        }

        set.status = 200;
        return part;
      } catch (error) {
        set.status = 500;
        return { error: (error as Error).message };
      }
    },
    {
      params: t.Object({
        id: t.String({ description: "Part ID" })
      }),
      response: {
        404: t.Object({ error: t.String() }),
        500: t.Object({ error: t.String() })
      },
      detail: {
        tags: ["Parts"],
        summary: "Get part by ID",
        description: "Retrieve a specific part by its ID"
      }
    }
  )

  // Update part
  .put(
    "/:id",
    async ({ params, body, set }) => {
      try {
        const updatedPart = await PartService.updatePart(params.id, body);
        
        if (!updatedPart) {
          set.status = 404;
          return { error: "Part not found" };
        }

        set.status = 200;
        return updatedPart;
      } catch (error) {
        set.status = 400;
        return { error: (error as Error).message };
      }
    },
    {
      params: t.Object({
        id: t.String({ description: "Part ID" })
      }),
      body: PartUpdateSchema,
      response: {
        400: t.Object({ error: t.String() }),
        404: t.Object({ error: t.String() })
      },
      detail: {
        tags: ["Parts"],
        summary: "Update part",
        description: "Update a part by ID"
      }
    }
  )

  // Delete part
  .delete(
    "/:id",
    async ({ params, set }) => {
      try {
        const deletedPart = await PartService.deletePart(params.id);
        
        if (!deletedPart) {
          set.status = 404;
          return { error: "Part not found" };
        }

        set.status = 200;
        return { message: "Part deleted successfully", part: deletedPart };
      } catch (error) {
        set.status = 500;
        return { error: (error as Error).message };
      }
    },
    {
      params: t.Object({
        id: t.String({ description: "Part ID" })
      }),
      response: {
        404: t.Object({ error: t.String() }),
        500: t.Object({ error: t.String() })
      },
      detail: {
        tags: ["Parts"],
        summary: "Delete part",
        description: "Delete a part by ID"
      }
    }
  )

  // Get parts by lab ID
  .get(
    "/lab/:labId",
    async ({ params, query, set }) => {
      try {
        const { page, limit } = query;
        const result = await PartService.getPartsByLab(
          params.labId,
          page ? parseInt(page) : undefined,
          limit ? parseInt(limit) : undefined
        );
        
        set.status = 200;
        return result;
      } catch (error) {
        set.status = 500;
        return { error: (error as Error).message };
      }
    },
    {
      params: t.Object({
        labId: t.String({ description: "Lab ID" })
      }),
      query: t.Object({
        page: t.Optional(t.String({ description: "Page number" })),
        limit: t.Optional(t.String({ description: "Items per page" }))
      }),
      response: {
        500: t.Object({ error: t.String() })
      },
      detail: {
        tags: ["Parts"],
        summary: "Get parts by lab",
        description: "Get all parts for a specific lab"
      }
    }
  )

  // Get part statistics
  .get(
    "/statistics/:labId?",
    async ({ params, set }) => {
      try {
        const stats = await PartService.getPartStatistics(params.labId);
        set.status = 200;
        return stats;
      } catch (error) {
        set.status = 500;
        return { error: (error as Error).message };
      }
    },
    {
      params: t.Object({
        labId: t.Optional(t.String({ description: "Optional lab ID for lab-specific stats" }))
      }),
      response: {
        500: t.Object({ error: t.String() })
      },
      detail: {
        tags: ["Parts"],
        summary: "Get part statistics",
        description: "Get statistics about parts (optionally filtered by lab)"
      }
    }
  );