import { Lab, ILab } from "./model";
import { getDateWithTimezone } from "../../utils/helpers";
import { env } from "process";
import { Types } from "mongoose";
import { ObjectId } from "mongodb";
import { User } from "../auth/model";
import { IpAllocationService } from "../../services/ip-allocation";

/**
 * Lab Service - Business logic for lab operations
 */
export class LabService {

  /**
   * Create a new lab
   */
  static async createLab(labData: any, createdBy: string) {
    try {
      // Find user by u_id and get their MongoDB _id
      const user = await User.findOne({ u_id: createdBy });
      if (!user) {
        throw new Error(`User not found with u_id: ${createdBy}`);
      }

      const newLab = new Lab({
        courseId: new ObjectId(labData.courseId),
        title: labData.title,
        description: labData.description,
        type: labData.type || 'lab',
        network: labData.network,
        createdBy: user._id,
        publishedAt: labData.publishedAt,
        dueDate: labData.dueDate
      });

      const savedLab = await newLab.save();

      // Transform response to match frontend interface
      return {
        ...savedLab.toObject(),
        id: savedLab._id?.toString(),
        _id: undefined
      };
    } catch (error) {
      throw new Error(`Error creating lab: ${(error as Error).message}`);
    }
  }

  /**
   * Get all labs with filtering and pagination
   */
  static async getLabs(filters: {
    courseId?: string;
    createdBy?: string;
    type?: string;
    page?: number;
    limit?: number;
  }) {
    try {
      const { courseId, createdBy, type, page = 1, limit = 10 } = filters;
      const skip = (page - 1) * limit;

      // Build query filter
      const filter: any = {};
      if (courseId) filter.courseId = courseId;
      if (createdBy) filter.createdBy = createdBy;
      if (type) filter.type = type;

      const [labs, total] = await Promise.all([
        Lab.find(filter)
          .skip(skip)
          .limit(limit)
          .sort({ createdAt: -1 })
          .lean(),
        Lab.countDocuments(filter)
      ]);

      // Transform data to match frontend interface
      const transformedLabs = labs.map(lab => ({
        ...lab,
        id: lab._id?.toString(),
        _id: undefined
      }));

      return {
        labs: transformedLabs,
        pagination: {
          currentPage: page,
          totalPages: Math.ceil(total / limit),
          totalItems: total,
          itemsPerPage: limit
        }
      };
    } catch (error) {
      throw new Error(`Error fetching labs: ${(error as Error).message}`);
    }
  }

  /**
   * Get lab by ID
   */
  static async getLabById(id: string) {
    try {
      const lab = await Lab.findById(id).lean();
      
      if (!lab) {
        return null;
      }

      // Transform data to match frontend interface
      return {
        ...lab,
        id: lab._id?.toString(),
        _id: undefined
      };
    } catch (error) {
      throw new Error(`Error fetching lab: ${(error as Error).message}`);
    }
  }

  /**
   * Update lab by ID
   */
  static async updateLab(id: string, updateData: any) {
    try {
      // Filter out undefined values for partial updates
      const filteredData = Object.fromEntries(
        Object.entries(updateData).filter(([_, value]) => value !== undefined)
      );

      // Only allow updating specific fields
      const allowedFields = ['title', 'description', 'type', 'courseId', 'network', 'publishedAt', 'availableFrom', 'availableUntil', 'dueDate'];
      const updateFields: any = {};

      allowedFields.forEach(field => {
        if (filteredData[field] !== undefined) {
          updateFields[field] = filteredData[field];
        }
      });

      updateFields.updatedAt = getDateWithTimezone(
        env.TIMEZONE_OFFSET ? parseInt(env.TIMEZONE_OFFSET) : 7
      );

      const updatedLab = await Lab.findByIdAndUpdate(
        id,
        { $set: updateFields },
        { new: true, runValidators: true }
      );

      if (!updatedLab) {
        return null;
      }

      // If network configuration changed, clear related IP cache
      if (updateFields.network) {
        await IpAllocationService.clearLabIPCache(id);
      }

      // Transform response to match frontend interface
      return {
        ...updatedLab.toObject(),
        id: updatedLab._id?.toString(),
        _id: undefined
      };
    } catch (error) {
      throw new Error(`Error updating lab: ${(error as Error).message}`);
    }
  }

  /**
   * Delete lab by ID
   */
  static async deleteLab(id: string) {
    try {
      const deletedLab = await Lab.findByIdAndDelete(id);
      
      if (deletedLab) {
        // Clear related IP cache when lab is deleted
        await IpAllocationService.clearLabIPCache(id);
      }
      
      return deletedLab;
    } catch (error) {
      throw new Error(`Error deleting lab: ${(error as Error).message}`);
    }
  }

  /**
   * Get labs by course ID
   */
  static async getLabsByCourse(courseId: string, page: number = 1, limit: number = 10) {
    try {
      const courseObjectId = new ObjectId(courseId);
      const skip = (page - 1) * limit;

      const [labs, total] = await Promise.all([
        Lab.find({ courseId: courseObjectId })
          .skip(skip)
          .limit(limit)
          .sort({ createdAt: -1 })
          .lean(),
        Lab.countDocuments({ courseId: courseObjectId })
      ]);

      // Transform data to match frontend interface
      const transformedLabs = labs.map(lab => ({
        ...lab,
        id: lab._id?.toString(),
        _id: undefined
      }));

      return {
        labs: transformedLabs,
        pagination: {
          currentPage: page,
          totalPages: Math.ceil(total / limit),
          totalItems: total,
          itemsPerPage: limit
        }
      };
    } catch (error) {
      throw new Error(`Error fetching labs for course: ${(error as Error).message}`);
    }
  }

  /**
   * Get lab statistics
   */
  static async getLabStatistics(courseId?: string) {
    try {
      const filter = courseId ? { courseId } : {};

      const [
        totalLabs,
        labsByType
      ] = await Promise.all([
        Lab.countDocuments(filter),
        Lab.aggregate([
          { $match: filter },
          { $group: { _id: "$type", count: { $sum: 1 } } }
        ])
      ]);

      return {
        totalLabs,
        labsByType: labsByType.reduce((acc, item) => {
          acc[item._id || 'lab'] = item.count;
          return acc;
        }, {} as Record<string, number>)
      };
    } catch (error) {
      throw new Error(`Error fetching lab statistics: ${(error as Error).message}`);
    }
  }

  /**
   * Get lab with full details including network information
   */
  static async getLabWithDetails(id: string) {
    try {
      const lab = await Lab.findById(id).lean();
      
      if (!lab) {
        return null;
      }

      // Transform data to match frontend interface
      return {
        ...lab,
        id: lab._id?.toString(),
        _id: undefined
      };
    } catch (error) {
      throw new Error(`Error fetching lab with details: ${(error as Error).message}`);
    }
  }
}
