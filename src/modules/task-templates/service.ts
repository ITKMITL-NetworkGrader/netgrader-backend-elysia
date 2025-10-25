import { TaskTemplate } from "./model";
import {
  CustomTaskTemplate,
  getAllCustomTaskTemplates,
  getCustomTaskTemplateById,
  getCustomTaskTemplateByTemplateId,
} from "./custom-template-source";

type TaskTemplateDTO = CustomTaskTemplate;

/**
 * TaskTemplate Service - Business logic for task template operations
 */
export class TaskTemplateService {

  /**
   * Create a new task template
   */
  static async createTaskTemplate(templateData: any) {
    try {
      const existingExternal = await getCustomTaskTemplateByTemplateId(templateData.templateId);
      if (existingExternal) {
        throw new Error(`Template ID '${templateData.templateId}' already exists in MinIO custom templates. Please choose a different templateId.`);
      }

      const newTemplate = new TaskTemplate({
        templateId: templateData.templateId,
        name: templateData.name,
        description: templateData.description,
        parameterSchema: templateData.parameterSchema || [],
        defaultTestCases: templateData.defaultTestCases || []
      });

      const savedTemplate = await newTemplate.save();

      return TaskTemplateService.normalizeMongoTemplate(savedTemplate.toObject());
    } catch (error) {
      throw new Error(`Error creating task template: ${(error as Error).message}`);
    }
  }

  /**
   * Get all task templates with filtering and pagination
   */
  static async getAllTaskTemplates(filters: {
    templateId?: string;
    name?: string;
    page?: number;
    limit?: number;
  } = {}) {
    try {
      const { templateId, name, page = 1, limit = 10 } = filters;

      const dbFilter: any = {};
      if (templateId) dbFilter.templateId = { $regex: templateId, $options: 'i' };
      if (name) dbFilter.name = { $regex: name, $options: 'i' };

      const [mongoTemplates, externalTemplates] = await Promise.all([
        TaskTemplate.find(dbFilter)
          .sort({ updatedAt: -1 })
          .lean(),
        getAllCustomTaskTemplates()
      ]);

      const normalizedMongo = mongoTemplates.map((template) => TaskTemplateService.normalizeMongoTemplate(template));
      const filteredExternal = externalTemplates.filter((template) =>
        TaskTemplateService.matchesFilters(template, templateId, name)
      );

      const combined: TaskTemplateDTO[] = [...normalizedMongo, ...filteredExternal];
      combined.sort((a, b) => {
        const aTime = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
        const bTime = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
        return bTime - aTime;
      });

      const safeLimit = Number.isFinite(limit) && limit > 0 ? limit : 10;
      const safePage = Number.isFinite(page) && page > 0 ? page : 1;
      const startIndex = (safePage - 1) * safeLimit;
      const paginatedTemplates = combined.slice(startIndex, startIndex + safeLimit);
      const totalItems = combined.length;

      return {
        templates: paginatedTemplates,
        pagination: {
          currentPage: safePage,
          totalPages: totalItems > 0 ? Math.ceil(totalItems / safeLimit) : 0,
          totalItems,
          itemsPerPage: safeLimit
        }
      };
    } catch (error) {
      throw new Error(`Error fetching task templates: ${(error as Error).message}`);
    }
  }

  /**
   * Get task template by ID
   */
  static async getTaskTemplateById(id: string) {
    try {
      const template = await TaskTemplate.findById(id).lean();
      
      if (!template) {
        return getCustomTaskTemplateById(id);
      }

      return TaskTemplateService.normalizeMongoTemplate(template);
    } catch (error) {
      throw new Error(`Error fetching task template: ${(error as Error).message}`);
    }
  }

  /**
   * Get task template by templateId (with caching)
   */
  static async getTaskTemplateByTemplateId(templateId: string) {
    try {
      const template = await TaskTemplate.findOne({ templateId }).lean();
      
      if (!template) {
        const externalTemplate = await getCustomTaskTemplateByTemplateId(templateId);
        if (externalTemplate) {
          return externalTemplate;
        }
        return null;
      }

      const result = TaskTemplateService.normalizeMongoTemplate(template);

      return result;
    } catch (error) {
      throw new Error(`Error fetching task template: ${(error as Error).message}`);
    }
  }

  /**
   * Update task template by ID
   */
  static async updateTaskTemplate(id: string, updateData: any) {
    try {
      const filteredData = Object.fromEntries(
        Object.entries(updateData).filter(([_, value]) => value !== undefined)
      );

      const allowedFields = ['templateId', 'name', 'description', 'parameterSchema', 'defaultTestCases'];
      const updateFields: any = {};
      
      allowedFields.forEach(field => {
        if (filteredData[field] !== undefined) {
          updateFields[field] = filteredData[field];
        }
      });

      const updatedTemplate = await TaskTemplate.findByIdAndUpdate(
        id,
        { $set: updateFields },
        { new: true, runValidators: true }
      );

      if (!updatedTemplate) {
        const externalTemplate = await getCustomTaskTemplateById(id);
        if (externalTemplate) {
          throw new Error('Custom templates managed in MinIO cannot be updated through this API.');
        }
        return null;
      }

      return TaskTemplateService.normalizeMongoTemplate(updatedTemplate.toObject());
    } catch (error) {
      throw new Error(`Error updating task template: ${(error as Error).message}`);
    }
  }

  /**
   * Delete task template by ID
   */
  static async deleteTaskTemplate(id: string) {
    try {
      const deletedTemplate = await TaskTemplate.findByIdAndDelete(id);
      
      if (!deletedTemplate) {
        const externalTemplate = await getCustomTaskTemplateById(id);
        if (externalTemplate) {
          throw new Error('Custom templates managed in MinIO cannot be deleted through this API.');
        }
        return null;
      }

      return TaskTemplateService.normalizeMongoTemplate(deletedTemplate.toObject());
    } catch (error) {
      throw new Error(`Error deleting task template: ${(error as Error).message}`);
    }
  }

  private static normalizeMongoTemplate(template: any): TaskTemplateDTO {
    const { _id, ...rest } = template;
    return {
      ...rest,
      id: _id?.toString(),
      templateId: template.templateId,
      name: template.name,
      description: template.description,
      parameterSchema: template.parameterSchema ?? [],
      defaultTestCases: template.defaultTestCases ?? [],
      createdAt: template.createdAt ? new Date(template.createdAt) : undefined,
      updatedAt: template.updatedAt ? new Date(template.updatedAt) : undefined,
      source: 'mongo',
    };
  }

  private static matchesFilters(template: TaskTemplateDTO, templateId?: string, name?: string): boolean {
    const matchesTemplateId = templateId
      ? new RegExp(templateId, 'i').test(template.templateId ?? '')
      : true;

    const matchesName = name ? new RegExp(name, 'i').test(template.name ?? '') : true;

    return matchesTemplateId && matchesName;
  }
}
