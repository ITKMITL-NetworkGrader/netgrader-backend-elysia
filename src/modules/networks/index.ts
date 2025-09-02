import { Elysia, t } from "elysia";
import { NetworkService } from "./service";
import { authPlugin, requireRole } from "../../plugins/plugins";

// Simplified schemas for Swagger compatibility
const ipSchema = t.Object({
    "scope": t.Union([t.Literal("lab"), t.Literal("part")]),
    "baseNetwork": t.String(),
    "subnetMask": t.Number({default: 24}),
    "allocationStrategy": t.Union([t.Literal("group_based"), t.Literal("student_id_based")]),
    "reservedSubnets": t.Array(t.String(), {default: []}),
    "variablesMapping": t.Array(t.Object({
        "name": t.String(),
        "hostOffset": t.String()
    }))
});

const deviceMappings = t.Array(t.Object({
    "deviceId": t.String(),
    "ipVariable": t.String()
}));

const NetworkCreateSchema = t.Object({
  name: t.String({ description: "Network name" }),
  ipSchema: ipSchema,
  deviceMappings: t.Optional(deviceMappings)
});

const NetworkUpdateSchema = t.Object({
  name: t.Optional(t.String({ description: "Network name" })),
  ipSchema: t.Optional(ipSchema),
  deviceMappings: t.Optional(deviceMappings)
});

export const networkRoutes = new Elysia({ prefix: "/networks" })
  .use(authPlugin)
  
  // Get all networks with filtering
  .get(
    "/",
    async ({ query, set }) => {
      try {
        const { createdBy, name, page, limit } = query;
        const filters = {
          createdBy,
          name,
          page: page ? parseInt(page) : undefined,
          limit: limit ? parseInt(limit) : undefined
        };

        const result = await NetworkService.getAllNetworks(filters);
        set.status = 200;
        return {
          success: true,
          message: "Networks fetched successfully",
          data: result
        };
      } catch (error) {
        set.status = 500;
        return { 
          success: false,
          message: "Error fetching networks",
          error: (error as Error).message 
        };
      }
    },
    {
      query: t.Object({
        createdBy: t.Optional(t.String({ description: "Filter by creator" })),
        name: t.Optional(t.String({ description: "Search by network name" })),
        page: t.Optional(t.String({ description: "Page number" })),
        limit: t.Optional(t.String({ description: "Items per page" }))
      }),
      detail: {
        tags: ["Networks"],
        summary: "Get all networks",
        description: "Retrieve all lab networks with optional filtering and pagination"
      }
    }
  )

  // Create new network
  .post(
    "/",
    async ({ body, set, authPlugin }) => {
      try {
        const { u_id } = authPlugin ?? { u_id: "" };
        
        if (!u_id) {
          set.status = 401;
          return { 
            success: false,
            message: "Authentication required" 
          };
        }

        // Validate IP schema and device mappings
        if (!NetworkService.validateIpSchema(body.ipSchema)) {
          set.status = 400;
          return {
            success: false,
            message: "Invalid IP schema format"
          };
        }

        if (body.deviceMappings && !NetworkService.validateDeviceMappings(body.deviceMappings)) {
          set.status = 400;
          return {
            success: false,
            message: "Invalid device mappings format"
          };
        }

        const newNetwork = await NetworkService.createNetwork(body, u_id);
        set.status = 201;
        return {
          success: true,
          message: "Network created successfully",
          data: newNetwork
        };
      } catch (error) {
        set.status = 400;
        return { 
          success: false,
          message: "Error creating network",
          error: (error as Error).message 
        };
      }
    },
    {
      body: NetworkCreateSchema,
      beforeHandle: requireRole(["ADMIN", "INSTRUCTOR"]),
      detail: {
        tags: ["Networks"],
        summary: "Create new network",
        description: "Create a new lab network"
      }
    }
  )

  // Get network by ID
  .get(
    "/:id",
    async ({ params, set }) => {
      try {
        const network = await NetworkService.getNetworkById(params.id);
        
        if (!network) {
          set.status = 404;
          return { 
            success: false,
            message: "Network not found" 
          };
        }

        set.status = 200;
        return {
          success: true,
          message: "Network fetched successfully",
          data: network
        };
      } catch (error) {
        set.status = 500;
        return { 
          success: false,
          message: "Error fetching network",
          error: (error as Error).message 
        };
      }
    },
    {
      params: t.Object({
        id: t.String({ description: "Network ID" })
      }),
      detail: {
        tags: ["Networks"],
        summary: "Get network by ID",
        description: "Retrieve a specific network by its ID"
      }
    }
  )

  // Update network
  .put(
    "/:id",
    async ({ params, body, set }) => {
      try {
        // Validate IP schema if provided
        if (body.ipSchema && !NetworkService.validateIpSchema(body.ipSchema)) {
          set.status = 400;
          return {
            success: false,
            message: "Invalid IP schema format"
          };
        }

        // Validate device mappings if provided
        if (body.deviceMappings && !NetworkService.validateDeviceMappings(body.deviceMappings)) {
          set.status = 400;
          return {
            success: false,
            message: "Invalid device mappings format"
          };
        }

        const updatedNetwork = await NetworkService.updateNetwork(params.id, body);
        
        if (!updatedNetwork) {
          set.status = 404;
          return { 
            success: false,
            message: "Network not found" 
          };
        }

        set.status = 200;
        return {
          success: true,
          message: "Network updated successfully",
          data: updatedNetwork
        };
      } catch (error) {
        set.status = 400;
        return { 
          success: false,
          message: "Error updating network",
          error: (error as Error).message 
        };
      }
    },
    {
      params: t.Object({
        id: t.String({ description: "Network ID" })
      }),
      body: NetworkUpdateSchema,
      beforeHandle: requireRole(["ADMIN", "INSTRUCTOR"]),
      detail: {
        tags: ["Networks"],
        summary: "Update network",
        description: "Update a network by ID"
      }
    }
  )

  // Delete network
  .delete(
    "/:id",
    async ({ params, set }) => {
      try {
        const deletedNetwork = await NetworkService.deleteNetwork(params.id);
        
        if (!deletedNetwork) {
          set.status = 404;
          return { 
            success: false,
            message: "Network not found" 
          };
        }

        set.status = 200;
        return {
          success: true,
          message: "Network deleted successfully",
          data: deletedNetwork
        };
      } catch (error) {
        set.status = 500;
        return { 
          success: false,
          message: "Error deleting network",
          error: (error as Error).message 
        };
      }
    },
    {
      params: t.Object({
        id: t.String({ description: "Network ID" })
      }),
      beforeHandle: requireRole(["ADMIN", "INSTRUCTOR"]),
      detail: {
        tags: ["Networks"],
        summary: "Delete network",
        description: "Delete a network by ID"
      }
    }
  )

  // Get networks by creator
  .get(
    "/creator/:createdBy",
    async ({ params, query, set }) => {
      try {
        const { page, limit } = query;
        const result = await NetworkService.getNetworksByCreator(
          params.createdBy,
          page ? parseInt(page) : undefined,
          limit ? parseInt(limit) : undefined
        );
        
        set.status = 200;
        return {
          success: true,
          message: "Networks fetched successfully",
          data: result
        };
      } catch (error) {
        set.status = 500;
        return { 
          success: false,
          message: "Error fetching networks for creator",
          error: (error as Error).message 
        };
      }
    },
    {
      params: t.Object({
        createdBy: t.String({ description: "Creator ID" })
      }),
      query: t.Object({
        page: t.Optional(t.String({ description: "Page number" })),
        limit: t.Optional(t.String({ description: "Items per page" }))
      }),
      detail: {
        tags: ["Networks"],
        summary: "Get networks by creator",
        description: "Get all networks created by a specific user"
      }
    }
  )

  // Get network statistics
  .get(
    "/statistics/:createdBy?",
    async ({ params, set }) => {
      try {
        const stats = await NetworkService.getNetworkStatistics(params.createdBy);
        set.status = 200;
        return {
          success: true,
          message: "Network statistics fetched successfully",
          data: stats
        };
      } catch (error) {
        set.status = 500;
        return { 
          success: false,
          message: "Error fetching network statistics",
          error: (error as Error).message 
        };
      }
    },
    {
      params: t.Object({
        createdBy: t.Optional(t.String({ description: "Optional creator ID for user-specific stats" }))
      }),
      detail: {
        tags: ["Networks"],
        summary: "Get network statistics",
        description: "Get statistics about networks (optionally filtered by creator)"
      }
    }
  );
