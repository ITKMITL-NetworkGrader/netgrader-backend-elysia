import { TaskTemplate, ITaskTemplate } from "./model";
import { CacheService } from "../../config/redis";

/**
 * TaskTemplate Service - Business logic for task template operations
 */
export class TaskTemplateService {

  /**
   * Create a new task template
   */
  static async createTaskTemplate(templateData: any) {
    try {
      const newTemplate = new TaskTemplate({
        templateId: templateData.templateId,
        name: templateData.name,
        description: templateData.description,
        parameterSchema: templateData.parameterSchema || [],
        defaultTestCases: templateData.defaultTestCases || []
      });

      const savedTemplate = await newTemplate.save();

      return {
        ...savedTemplate.toObject(),
        id: savedTemplate._id?.toString(),
        _id: undefined
      };
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
      const skip = (page - 1) * limit;

      // Build query filter
      const filter: any = {};
      if (templateId) filter.templateId = { $regex: templateId, $options: 'i' };
      if (name) filter.name = { $regex: name, $options: 'i' };

      const [templates, total] = await Promise.all([
        TaskTemplate.find(filter)
          .skip(skip)
          .limit(limit)
          .sort({ createdAt: -1 })
          .lean(),
        TaskTemplate.countDocuments(filter)
      ]);

      const transformedTemplates = templates.map(template => ({
        ...template,
        id: template._id?.toString(),
        _id: undefined
      }));

      return {
        templates: transformedTemplates,
        pagination: {
          currentPage: page,
          totalPages: Math.ceil(total / limit),
          totalItems: total,
          itemsPerPage: limit
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
        return null;
      }

      return {
        ...template,
        id: template._id?.toString(),
        _id: undefined
      };
    } catch (error) {
      throw new Error(`Error fetching task template: ${(error as Error).message}`);
    }
  }

  /**
   * Get task template by templateId (with caching)
   */
  static async getTaskTemplateByTemplateId(templateId: string) {
    try {
      // Check cache first
      const cached = await CacheService.getTaskTemplate(templateId);
      if (cached) {
        return cached;
      }

      const template = await TaskTemplate.findOne({ templateId }).lean();
      
      if (!template) {
        return null;
      }

      const result = {
        ...template,
        id: template._id?.toString(),
        _id: undefined
      };

      // Cache the result
      await CacheService.setTaskTemplate(templateId, result);

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
        return null;
      }

      return {
        ...updatedTemplate.toObject(),
        id: updatedTemplate._id?.toString(),
        _id: undefined
      };
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
        return null;
      }

      return {
        ...deletedTemplate.toObject(),
        id: deletedTemplate._id?.toString(),
        _id: undefined
      };
    } catch (error) {
      throw new Error(`Error deleting task template: ${(error as Error).message}`);
    }
  }
}