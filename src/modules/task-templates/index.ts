import { Elysia, t } from "elysia";
import { TaskTemplateService } from "./service";
import { authPlugin, requireRole } from "../../plugins/plugins";
import { getMinioClient, BUCKET_NAME } from "../../config/minio";
import { clearCustomTaskTemplateCache } from "./custom-template-source";
import { env } from "process";

const TaskTemplateCreateSchema = t.Object({
  templateId: t.String({ description: "Unique template identifier" }),
  name: t.String({ description: "Template display name" }),
  description: t.String({ description: "What this template does" }),
  parameterSchema: t.Array(t.Object({
    name: t.String(),
    type: t.String(),
    description: t.Optional(t.String()),
    required: t.Boolean()
  }), { description: "Parameter validation schema" }),
  defaultTestCases: t.Array(t.Object({
    comparison_type: t.String(),
    expected_result: t.Any()
  }), { description: "Default test cases for this template" })
});

const TaskTemplateUpdateSchema = t.Object({
  templateId: t.Optional(t.String()),
  name: t.Optional(t.String()),
  description: t.Optional(t.String()),
  parameterSchema: t.Optional(t.Array(t.Object({
    name: t.String(),
    type: t.String(),
    description: t.Optional(t.String()),
    required: t.Boolean()
  }))),
  defaultTestCases: t.Optional(t.Array(t.Object({
    comparison_type: t.String(),
    expected_result: t.Any()
  })))
});

export const taskTemplateRoutes = new Elysia({ prefix: "/task-templates" })
  .use(authPlugin)

  // Get all task templates
  .get(
    "/",
    async ({ query, set }) => {
      try {
        const { templateId, name, page, limit } = query;
        const filters = {
          templateId,
          name,
          page: page ? parseInt(page) : undefined,
          limit: limit ? parseInt(limit) : undefined
        };

        const result = await TaskTemplateService.getAllTaskTemplates(filters);
        set.status = 200;
        return {
          success: true,
          message: "Task templates fetched successfully",
          data: result
        };
      } catch (error) {
        set.status = 500;
        return {
          success: false,
          message: "Error fetching task templates",
          error: (error as Error).message
        };
      }
    },
    {
      query: t.Object({
        templateId: t.Optional(t.String()),
        name: t.Optional(t.String()),
        page: t.Optional(t.String()),
        limit: t.Optional(t.String())
      }),
      detail: {
        tags: ["Task Templates"],
        summary: "Get All Task Templates"
      }
    }
  )

  // Create new task template
  .post(
    "/",
    async ({ body, set }) => {
      try {
        const newTemplate = await TaskTemplateService.createTaskTemplate(body);
        set.status = 201;
        return {
          success: true,
          message: "Task template created successfully",
          data: newTemplate
        };
      } catch (error) {
        set.status = 400;
        return {
          success: false,
          message: "Error creating task template",
          error: (error as Error).message
        };
      }
    },
    {
      body: TaskTemplateCreateSchema,
      beforeHandle: requireRole(["ADMIN", "INSTRUCTOR"]),
      detail: {
        tags: ["Task Templates"],
        summary: "Create Task Template"
      }
    }
  )

  // Get task template by ID
  .get(
    "/:id",
    async ({ params, set }) => {
      try {
        const template = await TaskTemplateService.getTaskTemplateById(params.id);

        if (!template) {
          set.status = 404;
          return {
            success: false,
            message: "Task template not found"
          };
        }

        set.status = 200;
        return {
          success: true,
          message: "Task template fetched successfully",
          data: template
        };
      } catch (error) {
        set.status = 500;
        return {
          success: false,
          message: "Error fetching task template",
          error: (error as Error).message
        };
      }
    },
    {
      params: t.Object({ id: t.String() }),
      detail: {
        tags: ["Task Templates"],
        summary: "Get Task Template by ID"
      }
    }
  )

  // Get task template by templateId
  .get(
    "/by-template-id/:templateId",
    async ({ params, set }) => {
      try {
        const template = await TaskTemplateService.getTaskTemplateByTemplateId(params.templateId);

        if (!template) {
          set.status = 404;
          return {
            success: false,
            message: "Task template not found"
          };
        }

        set.status = 200;
        return {
          success: true,
          message: "Task template fetched successfully",
          data: template
        };
      } catch (error) {
        set.status = 500;
        return {
          success: false,
          message: "Error fetching task template",
          error: (error as Error).message
        };
      }
    },
    {
      params: t.Object({ templateId: t.String() }),
      detail: {
        tags: ["Task Templates"],
        summary: "Get Task Template by Template ID"
      }
    }
  )

  // Update task template
  .put(
    "/:id",
    async ({ params, body, set }) => {
      try {
        const updatedTemplate = await TaskTemplateService.updateTaskTemplate(params.id, body);

        if (!updatedTemplate) {
          set.status = 404;
          return {
            success: false,
            message: "Task template not found"
          };
        }

        set.status = 200;
        return {
          success: true,
          message: "Task template updated successfully",
          data: updatedTemplate
        };
      } catch (error) {
        set.status = 400;
        return {
          success: false,
          message: "Error updating task template",
          error: (error as Error).message
        };
      }
    },
    {
      params: t.Object({ id: t.String() }),
      body: TaskTemplateUpdateSchema,
      beforeHandle: requireRole(["ADMIN", "INSTRUCTOR"]),
      detail: {
        tags: ["Task Templates"],
        summary: "Update Task Template"
      }
    }
  )

  // Delete task template
  .delete(
    "/:id",
    async ({ params, set }) => {
      try {
        const deletedTemplate = await TaskTemplateService.deleteTaskTemplate(params.id);

        if (!deletedTemplate) {
          set.status = 404;
          return {
            success: false,
            message: "Task template not found"
          };
        }

        set.status = 200;
        return {
          success: true,
          message: "Task template deleted successfully",
          data: deletedTemplate
        };
      } catch (error) {
        set.status = 500;
        return {
          success: false,
          message: "Error deleting task template",
          error: (error as Error).message
        };
      }
    },
    {
      params: t.Object({ id: t.String() }),
      beforeHandle: requireRole(["ADMIN", "INSTRUCTOR"]),
      detail: {
        tags: ["Task Templates"],
        summary: "Delete Task Template"
      }
    }
  )

  // Upload custom task template to MinIO
  .post(
    "/upload",
    async ({ body, set }) => {
      try {
        const { filename, content } = body;

        // Validate filename
        if (!filename.endsWith('.yaml') && !filename.endsWith('.yml')) {
          set.status = 400;
          return {
            success: false,
            message: "Filename must end with .yaml or .yml"
          };
        }

        // Sanitize filename
        const sanitizedFilename = filename
          .toLowerCase()
          .replace(/[^a-z0-9_.-]/g, '_');

        // Get MinIO client and upload
        const client = getMinioClient();
        const prefix = env.MINIO_TASK_TEMPLATE_PREFIX || 'custom_tasks';
        const objectName = `${prefix}/${sanitizedFilename}`;

        // Convert content to buffer
        const buffer = Buffer.from(content, 'utf-8');

        // Upload to MinIO
        await client.putObject(
          BUCKET_NAME,
          objectName,
          buffer,
          buffer.length,
          {
            'Content-Type': 'text/yaml',
          }
        );

        // Clear template cache to pick up new template
        clearCustomTaskTemplateCache();

        set.status = 201;
        return {
          success: true,
          message: "Template uploaded successfully",
          data: {
            filename: sanitizedFilename,
            objectName,
            bucket: BUCKET_NAME
          }
        };
      } catch (error) {
        console.error("Failed to upload template:", error);
        set.status = 500;
        return {
          success: false,
          message: "Error uploading template",
          error: (error as Error).message
        };
      }
    },
    {
      body: t.Object({
        filename: t.String({ description: "Filename for the template (must end with .yaml or .yml)" }),
        content: t.String({ description: "YAML content of the template" })
      }),
      beforeHandle: requireRole(["ADMIN", "INSTRUCTOR"]),
      detail: {
        tags: ["Task Templates"],
        summary: "Upload Custom Task Template to MinIO"
      }
    }
  )

  // Get raw YAML content for a MinIO template
  .get(
    "/minio/:id/raw",
    async ({ params, set }) => {
      try {
        const template = await TaskTemplateService.getTaskTemplateById(params.id);

        if (!template) {
          set.status = 404;
          return {
            success: false,
            message: "Template not found"
          };
        }

        if (template.source !== 'minio') {
          set.status = 400;
          return {
            success: false,
            message: "This endpoint only supports MinIO templates. Use the standard GET endpoint for MongoDB templates."
          };
        }

        const rawYaml = (template as any).rawYaml;
        if (!rawYaml) {
          set.status = 404;
          return {
            success: false,
            message: "Raw YAML content not found for this template"
          };
        }

        set.status = 200;
        return {
          success: true,
          message: "Raw YAML content fetched successfully",
          data: {
            templateId: template.templateId,
            name: template.name,
            rawYaml
          }
        };
      } catch (error) {
        set.status = 500;
        return {
          success: false,
          message: "Error fetching raw YAML content",
          error: (error as Error).message
        };
      }
    },
    {
      params: t.Object({ id: t.String() }),
      detail: {
        tags: ["Task Templates"],
        summary: "Get Raw YAML Content for MinIO Template"
      }
    }
  )

  // Update MinIO template
  .put(
    "/minio/:id",
    async ({ params, body, set }) => {
      try {
        const updatedTemplate = await TaskTemplateService.updateMinioTemplate(params.id, body.content);

        set.status = 200;
        return {
          success: true,
          message: "MinIO template updated successfully",
          data: updatedTemplate
        };
      } catch (error) {
        const errorMessage = (error as Error).message;

        if (errorMessage.includes('not found')) {
          set.status = 404;
          return {
            success: false,
            message: "MinIO template not found",
            error: errorMessage
          };
        }

        set.status = 500;
        return {
          success: false,
          message: "Error updating MinIO template",
          error: errorMessage
        };
      }
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        content: t.String({ description: "Updated YAML content" })
      }),
      beforeHandle: requireRole(["ADMIN", "INSTRUCTOR"]),
      detail: {
        tags: ["Task Templates"],
        summary: "Update MinIO Task Template"
      }
    }
  )

  // Delete MinIO template
  .delete(
    "/minio/:id",
    async ({ params, set }) => {
      try {
        const deletedTemplate = await TaskTemplateService.deleteMinioTemplate(params.id);

        set.status = 200;
        return {
          success: true,
          message: "MinIO template deleted successfully",
          data: deletedTemplate
        };
      } catch (error) {
        const errorMessage = (error as Error).message;

        if (errorMessage.includes('not found')) {
          set.status = 404;
          return {
            success: false,
            message: "MinIO template not found",
            error: errorMessage
          };
        }

        set.status = 500;
        return {
          success: false,
          message: "Error deleting MinIO template",
          error: errorMessage
        };
      }
    },
    {
      params: t.Object({ id: t.String() }),
      beforeHandle: requireRole(["ADMIN", "INSTRUCTOR"]),
      detail: {
        tags: ["Task Templates"],
        summary: "Delete MinIO Task Template"
      }
    }
  );