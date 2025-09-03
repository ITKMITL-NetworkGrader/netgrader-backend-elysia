import { Elysia, t } from "elysia";
import { DeviceTemplateService } from "./service";
import { authPlugin, requireRole } from "../../plugins/plugins";

const DeviceTemplateCreateSchema = t.Object({
  name: t.String({ description: "Template display name" }),
  deviceType: t.Union([
    t.Literal("router"),
    t.Literal("switch"), 
    t.Literal("server")
  ], { description: "Type of network device" }),
  platform: t.String({ description: "Device platform (e.g., cisco_ios, linux)" }),
  defaultInterfaces: t.Array(t.Object({
    name: t.String(),
    type: t.Union([
      t.Literal("ethernet"),
      t.Literal("serial"),
      t.Literal("loopback"),
      t.Literal("tunnel"),
      t.Literal("vlan")
    ]),
    description: t.Optional(t.String()),
    isManagement: t.Optional(t.Boolean())
  }), { description: "Default network interfaces" }),
  connectionParams: t.Object({
    defaultSSHPort: t.Number({ description: "Default SSH port" }),
    alternativePorts: t.Optional(t.Array(t.Number())),
    authentication: t.Object({
      usernameTemplate: t.String(),
      passwordTemplate: t.String(),
      enablePasswordTemplate: t.Optional(t.String())
    })
  }),
  description: t.String({ description: "Template description" })
});

const DeviceTemplateUpdateSchema = t.Object({
  name: t.Optional(t.String()),
  deviceType: t.Optional(t.Union([
    t.Literal("router"),
    t.Literal("switch"), 
    t.Literal("server")
  ])),
  platform: t.Optional(t.String()),
  defaultInterfaces: t.Optional(t.Array(t.Object({
    name: t.String(),
    type: t.Union([
      t.Literal("ethernet"),
      t.Literal("serial"),
      t.Literal("loopback"),
      t.Literal("tunnel"),
      t.Literal("vlan")
    ]),
    description: t.Optional(t.String()),
    isManagement: t.Optional(t.Boolean())
  }))),
  connectionParams: t.Optional(t.Object({
    defaultSSHPort: t.Optional(t.Number()),
    alternativePorts: t.Optional(t.Array(t.Number())),
    authentication: t.Optional(t.Object({
      usernameTemplate: t.Optional(t.String()),
      passwordTemplate: t.Optional(t.String()),
      enablePasswordTemplate: t.Optional(t.String())
    }))
  })),
  description: t.Optional(t.String())
});

export const deviceTemplateRoutes = new Elysia({ prefix: "/device-templates" })
  .use(authPlugin)
  
  // Get all device templates
  .get(
    "/",
    async ({ query, set }) => {
      try {
        const { platform, deviceType, name, page, limit } = query;
        const filters = {
          platform,
          deviceType,
          name,
          page: page ? parseInt(page) : undefined,
          limit: limit ? parseInt(limit) : undefined
        };

        const result = await DeviceTemplateService.getAllDeviceTemplates(filters);
        set.status = 200;
        return {
          success: true,
          message: "Device templates fetched successfully",
          data: result
        };
      } catch (error) {
        set.status = 500;
        return { 
          success: false,
          message: "Error fetching device templates",
          error: (error as Error).message 
        };
      }
    },
    {
      query: t.Object({
        platform: t.Optional(t.String()),
        deviceType: t.Optional(t.String()),
        name: t.Optional(t.String()),
        page: t.Optional(t.String()),
        limit: t.Optional(t.String())
      }),
      detail: {
        tags: ["Device Templates"],
        summary: "Get All Device Templates"
      }
    }
  )

  // Create new device template
  .post(
    "/",
    async ({ body, set }) => {
      try {
        const newTemplate = await DeviceTemplateService.createDeviceTemplate(body);
        set.status = 201;
        return {
          success: true,
          message: "Device template created successfully",
          data: newTemplate
        };
      } catch (error) {
        set.status = 400;
        return {
          success: false,
          message: "Error creating device template",
          error: (error as Error).message
        };
      }
    },
    {
      body: DeviceTemplateCreateSchema,
      beforeHandle: requireRole(["ADMIN", "INSTRUCTOR"]),
      detail: {
        tags: ["Device Templates"],
        summary: "Create Device Template"
      }
    }
  )

  // Get device template by ID
  .get(
    "/:id",
    async ({ params, set }) => {
      try {
        const template = await DeviceTemplateService.getDeviceTemplateById(params.id);
        
        if (!template) {
          set.status = 404;
          return {
            success: false,
            message: "Device template not found"
          };
        }

        set.status = 200;
        return {
          success: true,
          message: "Device template fetched successfully",
          data: template
        };
      } catch (error) {
        set.status = 500;
        return {
          success: false,
          message: "Error fetching device template",
          error: (error as Error).message
        };
      }
    },
    {
      params: t.Object({ id: t.String() }),
      detail: {
        tags: ["Device Templates"],
        summary: "Get Device Template by ID"
      }
    }
  )

  // Get device templates by platform
  .get(
    "/platform/:platform",
    async ({ params, set }) => {
      try {
        const templates = await DeviceTemplateService.getDeviceTemplatesByPlatform(params.platform);
        
        set.status = 200;
        return {
          success: true,
          message: "Device templates fetched successfully",
          data: templates
        };
      } catch (error) {
        set.status = 500;
        return {
          success: false,
          message: "Error fetching device templates by platform",
          error: (error as Error).message
        };
      }
    },
    {
      params: t.Object({ platform: t.String() }),
      detail: {
        tags: ["Device Templates"],
        summary: "Get Device Templates by Platform"
      }
    }
  )

  // Update device template
  .put(
    "/:id",
    async ({ params, body, set }) => {
      try {
        const updatedTemplate = await DeviceTemplateService.updateDeviceTemplate(params.id, body);
        
        if (!updatedTemplate) {
          set.status = 404;
          return {
            success: false,
            message: "Device template not found"
          };
        }

        set.status = 200;
        return {
          success: true,
          message: "Device template updated successfully",
          data: updatedTemplate
        };
      } catch (error) {
        set.status = 400;
        return {
          success: false,
          message: "Error updating device template",
          error: (error as Error).message
        };
      }
    },
    {
      params: t.Object({ id: t.String() }),
      body: DeviceTemplateUpdateSchema,
      beforeHandle: requireRole(["ADMIN", "INSTRUCTOR"]),
      detail: {
        tags: ["Device Templates"],
        summary: "Update Device Template"
      }
    }
  )

  // Delete device template
  .delete(
    "/:id",
    async ({ params, set }) => {
      try {
        const deletedTemplate = await DeviceTemplateService.deleteDeviceTemplate(params.id);
        
        if (!deletedTemplate) {
          set.status = 404;
          return {
            success: false,
            message: "Device template not found"
          };
        }

        set.status = 200;
        return {
          success: true,
          message: "Device template deleted successfully",
          data: deletedTemplate
        };
      } catch (error) {
        set.status = 500;
        return {
          success: false,
          message: "Error deleting device template",
          error: (error as Error).message
        };
      }
    },
    {
      params: t.Object({ id: t.String() }),
      beforeHandle: requireRole(["ADMIN", "INSTRUCTOR"]),
      detail: {
        tags: ["Device Templates"],
        summary: "Delete Device Template"
      }
    }
  );