import { DeviceTemplate, IDeviceTemplate } from "./model";
import { CacheService } from "../../config/redis";

/**
 * DeviceTemplate Service - Business logic for device template operations
 */
export class DeviceTemplateService {

  /**
   * Create a new device template
   */
  static async createDeviceTemplate(templateData: any) {
    try {
      const newTemplate = new DeviceTemplate({
        name: templateData.name,
        deviceType: templateData.deviceType,
        platform: templateData.platform,
        defaultInterfaces: templateData.defaultInterfaces || [],
        connectionParams: templateData.connectionParams,
        description: templateData.description
      });

      const savedTemplate = await newTemplate.save();

      return {
        ...savedTemplate.toObject(),
        id: savedTemplate._id?.toString(),
        _id: undefined
      };
    } catch (error) {
      throw new Error(`Error creating device template: ${(error as Error).message}`);
    }
  }

  /**
   * Get all device templates with filtering and pagination
   */
  static async getAllDeviceTemplates(filters: {
    platform?: string;
    deviceType?: string;
    name?: string;
    page?: number;
    limit?: number;
  } = {}) {
    try {
      const { platform, deviceType, name, page = 1, limit = 10 } = filters;
      const skip = (page - 1) * limit;

      // Build query filter
      const filter: any = {};
      if (platform) filter.platform = platform;
      if (deviceType) filter.deviceType = deviceType;
      if (name) filter.name = { $regex: name, $options: 'i' };

      const [templates, total] = await Promise.all([
        DeviceTemplate.find(filter)
          .skip(skip)
          .limit(limit)
          .sort({ createdAt: -1 })
          .lean(),
        DeviceTemplate.countDocuments(filter)
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
      throw new Error(`Error fetching device templates: ${(error as Error).message}`);
    }
  }

  /**
   * Get device template by ID (with caching)
   */
  static async getDeviceTemplateById(id: string) {
    try {
      // Check cache first
      const cached = await CacheService.getDeviceTemplate(id);
      if (cached) {
        return cached;
      }

      const template = await DeviceTemplate.findById(id).lean();
      
      if (!template) {
        return null;
      }

      const result = {
        ...template,
        id: template._id?.toString(),
        _id: undefined
      };

      // Cache the result
      await CacheService.setDeviceTemplate(id, result);

      return result;
    } catch (error) {
      throw new Error(`Error fetching device template: ${(error as Error).message}`);
    }
  }

  /**
   * Get device templates by platform
   */
  static async getDeviceTemplatesByPlatform(platform: string) {
    try {
      const templates = await DeviceTemplate.find({ platform })
        .sort({ name: 1 })
        .lean();

      return templates.map(template => ({
        ...template,
        id: template._id?.toString(),
        _id: undefined
      }));
    } catch (error) {
      throw new Error(`Error fetching device templates by platform: ${(error as Error).message}`);
    }
  }

  /**
   * Update device template by ID
   */
  static async updateDeviceTemplate(id: string, updateData: any) {
    try {
      const filteredData = Object.fromEntries(
        Object.entries(updateData).filter(([_, value]) => value !== undefined)
      );

      const allowedFields = ['name', 'deviceType', 'platform', 'defaultInterfaces', 'connectionParams', 'description'];
      const updateFields: any = {};
      
      allowedFields.forEach(field => {
        if (filteredData[field] !== undefined) {
          updateFields[field] = filteredData[field];
        }
      });

      const updatedTemplate = await DeviceTemplate.findByIdAndUpdate(
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
      throw new Error(`Error updating device template: ${(error as Error).message}`);
    }
  }

  /**
   * Delete device template by ID
   */
  static async deleteDeviceTemplate(id: string) {
    try {
      const deletedTemplate = await DeviceTemplate.findByIdAndDelete(id);
      
      if (!deletedTemplate) {
        return null;
      }

      return {
        ...deletedTemplate.toObject(),
        id: deletedTemplate._id?.toString(),
        _id: undefined
      };
    } catch (error) {
      throw new Error(`Error deleting device template: ${(error as Error).message}`);
    }
  }
}