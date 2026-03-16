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

  // Test-run template directly through FastAPI worker (no RabbitMQ)
  .post(
    "/test-run",
    async ({ body, set }) => {
      try {
        const workerBaseUrl = (env.WORKER_API_URL || env.FASTAPI_URL || "http://localhost:8000").replace(/\/+$/, "");
        const response = await fetch(`${workerBaseUrl}/template-tests/run`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          signal: AbortSignal.timeout(75000), // 75s — slightly longer than FastAPI's 60s timeout
          body: JSON.stringify({
            yaml_content: body.yamlContent,
            job_payload: body.jobPayload,
            validate_only: body.validateOnly ?? false,
            task_name_override: body.taskNameOverride
          })
        });

        const result = await response.json();

        if (!response.ok) {
          set.status = response.status;
          return {
            success: false,
            message: result?.detail || "Template test run failed",
            error: result
          };
        }

        set.status = 200;
        return {
          success: true,
          message: "Template test run completed",
          data: result
        };
      } catch (error) {
        set.status = 500;
        return {
          success: false,
          message: "Error running template test",
          error: (error as Error).message
        };
      }
    },
    {
      body: t.Object({
        yamlContent: t.String({ description: "Raw YAML template content", maxLength: 51200 }),
        jobPayload: t.Any({ description: "Direct grading job payload for testing" }),
        validateOnly: t.Optional(t.Boolean({ description: "Validate payload only, skip execution" })),
        taskNameOverride: t.Optional(t.String({ description: "Optional task_name override for preview testing" }))
      }),
      beforeHandle: requireRole(["ADMIN", "INSTRUCTOR"]),
      detail: {
        tags: ["Task Templates"],
        summary: "Run Template Test Directly"
      }
    }
  )

  // Dry-run a single parse_output action without a real device
  .post(
    "/parse-dry-run",
    async ({ body, set }) => {
      try {
        const workerBaseUrl = (env.WORKER_API_URL || env.FASTAPI_URL || "http://localhost:8000").replace(/\/+$/, "");
        const response = await fetch(`${workerBaseUrl}/template-tests/parse-dry-run`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: AbortSignal.timeout(15000),
          body: JSON.stringify({
            input: body.input,
            parser: body.parser,
            pattern: body.pattern ?? null,
            template: body.template ?? null,
            platform: body.platform ?? null,
            command: body.command ?? null,
          }),
        });
        const result = await response.json();
        if (!response.ok) {
          set.status = response.status;
          return { success: false, message: result?.detail || "Parse dry run failed", error: result };
        }
        set.status = 200;
        return { success: true, message: "Parse dry run completed", data: result };
      } catch (error) {
        set.status = 500;
        return { success: false, message: "Error running parse dry run", error: (error as Error).message };
      }
    },
    {
      body: t.Object({
        input: t.String({ description: "Raw device output text to parse" }),
        parser: t.Optional(t.String({ description: "Parser type: regex, textfsm, or jinja" })),
        pattern: t.Optional(t.String({ description: "Regex pattern or Jinja fallback pattern" })),
        template: t.Optional(t.String({ description: "TextFSM or Jinja template string" })),
        platform: t.Optional(t.String({ description: "NTC-templates platform (e.g. cisco_ios)" })),
        command: t.Optional(t.String({ description: "NTC-templates command (e.g. show interfaces)" })),
      }),
      beforeHandle: requireRole(["ADMIN", "INSTRUCTOR"]),
      detail: { tags: ["Task Templates"], summary: "Dry-run a parse_output action without a device" },
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