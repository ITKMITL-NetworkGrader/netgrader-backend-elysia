import { Elysia, t } from "elysia";
import { TaskTemplateService } from "./service";
import { authPlugin, requireRole } from "../../plugins/plugins";

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
  );