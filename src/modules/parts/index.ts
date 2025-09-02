import { Elysia, t } from "elysia";
import { PartService } from "./service";
import { authPlugin, requireRole } from "../../plugins/plugins";

// Simplified schemas for Swagger compatibility
const PartCreateSchema = t.Object({
  lab_id: t.String({ description: "Lab ID this part belongs to" }),
  title: t.String({ description: "Part title" }),
  textMd: t.String({ description: "Part content in Markdown" }),
  order: t.Number({ description: "Part order within lab" }),
  totalPoints: t.Number({ description: "Total points for this part" }),
  prerequisites: t.Optional(t.Array(t.String(), { description: "Array of prerequisite part IDs" }))
});

const PartUpdateSchema = t.Object({
  title: t.Optional(t.String({ description: "Part title" })),
  textMd: t.Optional(t.String({ description: "Part content in Markdown" })),
  order: t.Optional(t.Number({ description: "Part order within lab" })),
  totalPoints: t.Optional(t.Number({ description: "Total points for this part" })),
  prerequisites: t.Optional(t.Array(t.String(), { description: "Array of prerequisite part IDs" }))
});

export const partRoutes = new Elysia({ prefix: "/parts" })
  .use(authPlugin)
  
  // Get all parts with filtering
  .get(
    "/",
    async ({ query, set }) => {
      try {
        const { lab_id, createdBy, page, limit } = query;
        const filters = {
          lab_id,
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
        lab_id: t.Optional(t.String({ description: "Filter by lab ID" })),
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