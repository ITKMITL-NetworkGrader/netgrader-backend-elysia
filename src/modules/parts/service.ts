import { LabPart, ILabPart } from "./model";
import { Lab } from "../labs/model";
import { Types } from "mongoose";

/**
 * Part Service - Business logic for lab part operations
 */
export class PartService {

  /**
   * Create a new lab part
   */
  static async createPart(partData: any, createdBy: string) {
    try {
      // Validate that the lab exists
      const labExists = await Lab.findById(partData.labId);
      if (!labExists) {
        throw new Error(`Lab with ID ${partData.labId} does not exist`);
      }

      const newPart = new LabPart({
        labId: partData.labId,
        partId: partData.partId,
        title: partData.title,
        description: partData.description,
        instructions: partData.instructions,
        order: partData.order,
        tasks: partData.tasks || [],
        task_groups: partData.task_groups || [],
        prerequisites: (partData.prerequisites || []).filter((prereq: string) => prereq && prereq.trim() !== ''),
        totalPoints: partData.totalPoints
      });

      const savedPart = await newPart.save();

      // Transform response to match frontend interface
      return {
        ...savedPart.toObject(),
        id: savedPart._id?.toString(),
        _id: undefined
      };
    } catch (error) {
      throw new Error(`Error creating part: ${(error as Error).message}`);
    }
  }

  /**
   * Get all parts with filtering and pagination
   */
  static async getAllParts(filters: {
    labId?: string;
    createdBy?: string;
    page?: number;
    limit?: number;
  } = {}) {
    try {
      const { labId, createdBy, page = 1, limit = 10 } = filters;
      const skip = (page - 1) * limit;

      // Build query filter
      const filter: any = {};
      if (labId) filter.labId = labId;
      if (createdBy) filter.createdBy = createdBy;

      const [parts, total] = await Promise.all([
        LabPart.find(filter)
          .skip(skip)
          .limit(limit)
          .sort({ order: 1, createdAt: -1 })
          .lean(),
        LabPart.countDocuments(filter)
      ]);

      // Transform data to match frontend interface
      const transformedParts = parts.map(part => ({
        ...part,
        id: part._id?.toString(),
        labId: part.labId?.toString(),
        prerequisites: part.prerequisites?.filter(prereq => prereq && prereq.trim() !== '') || [],
        _id: undefined
      }));

      return {
        parts: transformedParts,
        pagination: {
          currentPage: page,
          totalPages: Math.ceil(total / limit),
          totalItems: total,
          itemsPerPage: limit
        }
      };
    } catch (error) {
      throw new Error(`Error fetching parts: ${(error as Error).message}`);
    }
  }

  /**
   * Get part by ID
   */
  static async getPartById(id: string) {
    try {
      const part = await LabPart.findById(id)
        .lean();
      
      if (!part) {
        return null;
      }

      // Transform data to match frontend interface
      return {
        ...part,
        id: part._id?.toString(),
        labId: part.labId?.toString(),
        prerequisites: part.prerequisites?.filter(prereq => prereq && prereq.trim() !== '') || [],
        _id: undefined
      };
    } catch (error) {
      throw new Error(`Error fetching part: ${(error as Error).message}`);
    }
  }

  /**
   * Update part by ID
   */
  static async updatePart(id: string, updateData: any) {
    try {
      // Filter out undefined values for partial updates
      const filteredData = Object.fromEntries(
        Object.entries(updateData).filter(([_, value]) => value !== undefined)
      );

      // Only allow updating specific fields
      const allowedFields = ['partId', 'title', 'description', 'instructions', 'order', 'tasks', 'task_groups', 'prerequisites', 'totalPoints'];
      const updateFields: any = {};
      
      allowedFields.forEach(field => {
        if (filteredData[field] !== undefined) {
          if (field === 'prerequisites' && Array.isArray(filteredData[field])) {
            // Filter out empty strings from prerequisites
            updateFields[field] = filteredData[field].filter((prereq: string) => prereq && prereq.trim() !== '');
          } else {
            updateFields[field] = filteredData[field];
          }
        }
      });

      const updatedPart = await LabPart.findByIdAndUpdate(
        id,
        { $set: updateFields },
        { new: true, runValidators: true }
      );

      if (!updatedPart) {
        return null;
      }

      // Transform response to match frontend interface
      return {
        ...updatedPart.toObject(),
        id: updatedPart._id?.toString(),
        lab_id: updatedPart.labId?.toString(),
        prerequisites: updatedPart.prerequisites?.filter(prereq => prereq && prereq.trim() !== '') || [],
        _id: undefined
      };
    } catch (error) {
      throw new Error(`Error updating part: ${(error as Error).message}`);
    }
  }

  /**
   * Delete part by ID
   */
  static async deletePart(id: string) {
    try {
      const deletedPart = await LabPart.findByIdAndDelete(id);
      
      if (!deletedPart) {
        return null;
      }

      return {
        ...deletedPart.toObject(),
        id: deletedPart._id?.toString(),
        prerequisites: deletedPart.prerequisites?.filter(prereq => prereq && prereq.trim() !== '') || [],
        labId: deletedPart.labId?.toString(),
        _id: undefined
      };
    } catch (error) {
      throw new Error(`Error deleting part: ${(error as Error).message}`);
    }
  }

  /**
   * Get parts by lab ID
   */
  static async getPartsByLab(labId: string, page: number = 1, limit: number = 10) {
    try {
      const skip = (page - 1) * limit;

      const [parts, total] = await Promise.all([
        LabPart.find({ labId: labId })
          .skip(skip)
          .limit(limit)
          .sort({ order: 1 })
          .lean(),
        LabPart.countDocuments({ labId: labId })
      ]);

      // Transform data to match frontend interface
      const transformedParts = parts.map(part => ({
        ...part,
        id: part._id?.toString(),
        labId: part.labId?.toString(),
        prerequisites: part.prerequisites?.filter(prereq => prereq && prereq.trim() !== '') || [],
        _id: undefined
      }));

      return {
        parts: transformedParts,
        pagination: {
          currentPage: page,
          totalPages: Math.ceil(total / limit),
          totalItems: total,
          itemsPerPage: limit
        }
      };
    } catch (error) {
      throw new Error(`Error fetching parts for lab: ${(error as Error).message}`);
    }
  }

  /**
   * Get part statistics
   */
  static async getPartStatistics(labId?: string) {
    try {
      const filter = labId ? { labId: labId } : {};

      const [
        totalParts,
        totalPoints,
        avgPointsPerPart
      ] = await Promise.all([
        LabPart.countDocuments(filter),
        LabPart.aggregate([
          { $match: filter },
          { $group: { _id: null, total: { $sum: "$totalPoints" } } }
        ]).then(result => result[0]?.total || 0),
        LabPart.aggregate([
          { $match: filter },
          { $group: { _id: null, avgPoints: { $avg: "$totalPoints" } } }
        ]).then(result => Math.round(result[0]?.avgPoints || 0))
      ]);

      return {
        totalParts,
        totalPoints,
        avgPointsPerPart
      };
    } catch (error) {
      throw new Error(`Error fetching part statistics: ${(error as Error).message}`);
    }
  }
}