import { LabModel, Lab, LabPart, IPlay, IAnsibleTask } from "./model";
import { getDateWithTimezone } from "../../utils/helpers";
import { env } from "process";

/**
 * Lab Service - Business logic for lab operations
 */
export class LabService {
  
  /**
   * Generate unique ID with prefix
   */
  private static generateId(prefix: string): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Process ansible tasks to auto-generate missing task_ids
   */
  private static processAnsibleTasks(tasks: IAnsibleTask[]): IAnsibleTask[] {
    return tasks.map(task => ({
      ...task,
      task_id: task.task_id || this.generateId('task')
    }));
  }

  /**
   * Process plays to auto-generate missing play_ids and task_ids
   */
  private static processPlays(plays: IPlay[]): IPlay[] {
    return plays.map(play => ({
      ...play,
      play_id: play.play_id || this.generateId('play'),
      ansible_tasks: this.processAnsibleTasks(play.ansible_tasks)
    }));
  }

  /**
   * Process lab parts to auto-generate missing part_ids, play_ids, and task_ids
   */
  private static processLabParts(parts: LabPart[]): LabPart[] {
    return parts.map(part => ({
      ...part,
      part_id: part.part_id || this.generateId('part'),
      plays: this.processPlays(part.plays)
    }));
  }

  /**
   * Process entire lab data to auto-generate all missing IDs
   */
  static processLabData(labData: any): any {
    return {
      ...labData,
      parts: this.processLabParts(labData.parts || [])
    };
  }

  /**
   * Process single lab part to auto-generate missing IDs
   */
  static processLabPart(partData: any): any {
    return {
      ...partData,
      part_id: partData.part_id || this.generateId('part'),
      plays: this.processPlays(partData.plays || [])
    };
  }

  /**
   * Create a new lab
   */
  static async createLab(labData: any, createdBy: string) {
    try {
      // Process the lab data to auto-generate missing IDs
      const processedLabData = this.processLabData(labData);
      
      const newLab = new LabModel({
        ...processedLabData,
        createdBy
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
        LabModel.find(filter)
          .skip(skip)
          .limit(limit)
          .sort({ createdAt: -1 })
          .lean(),
        LabModel.countDocuments(filter)
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
      const lab = await LabModel.findById(id).lean();
      
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

      // If parts are being updated, process them for ID generation
      if (filteredData.parts && Array.isArray(filteredData.parts)) {
        filteredData.parts = this.processLabParts(filteredData.parts as LabPart[]);
      }

      filteredData.updatedAt = getDateWithTimezone(
        env.TIMEZONE_OFFSET ? parseInt(env.TIMEZONE_OFFSET) : 7
      );

      const updatedLab = await LabModel.findByIdAndUpdate(
        id,
        { $set: filteredData },
        { new: true, runValidators: true }
      );

      if (!updatedLab) {
        return null;
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
      const deletedLab = await LabModel.findByIdAndDelete(id);
      return deletedLab;
    } catch (error) {
      throw new Error(`Error deleting lab: ${(error as Error).message}`);
    }
  }

  /**
   * Add part to lab
   */
  static async addPartToLab(labId: string, partData: any) {
    try {
      const lab = await LabModel.findById(labId);

      if (!lab) {
        return null;
      }

      // Process the new part to auto-generate missing IDs
      const processedPart = this.processLabPart(partData);

      lab.parts.push(processedPart);
      const updatedLab = await lab.save();

      // Transform response to match frontend interface
      return {
        ...updatedLab.toObject(),
        id: updatedLab._id?.toString(),
        _id: undefined
      };
    } catch (error) {
      throw new Error(`Error adding lab part: ${(error as Error).message}`);
    }
  }

  /**
   * Update specific lab part
   */
  static async updateLabPart(labId: string, partId: string, updateData: any) {
    try {
      const lab = await LabModel.findById(labId);

      if (!lab) {
        return { error: "Lab not found", lab: null };
      }

      const partIndex = lab.parts.findIndex(part => part.part_id === partId);

      if (partIndex === -1) {
        return { error: "Lab part not found", lab: null };
      }

      // Process update data for ID generation if plays are being updated
      if (updateData.plays) {
        updateData.plays = this.processPlays(updateData.plays);
      }

      // Update the part
      Object.assign(lab.parts[partIndex], updateData);
      const updatedLab = await lab.save();

      // Transform response to match frontend interface
      return {
        error: null,
        lab: {
          ...updatedLab.toObject(),
          id: updatedLab._id?.toString(),
          _id: undefined
        }
      };
    } catch (error) {
      throw new Error(`Error updating lab part: ${(error as Error).message}`);
    }
  }

  /**
   * Delete lab part
   */
  static async deleteLabPart(labId: string, partId: string) {
    try {
      const lab = await LabModel.findById(labId);

      if (!lab) {
        return { error: "Lab not found", lab: null };
      }

      const partIndex = lab.parts.findIndex(part => part.part_id === partId);

      if (partIndex === -1) {
        return { error: "Lab part not found", lab: null };
      }

      lab.parts.splice(partIndex, 1);
      const updatedLab = await lab.save();

      // Transform response to match frontend interface
      return {
        error: null,
        lab: {
          ...updatedLab.toObject(),
          id: updatedLab._id?.toString(),
          _id: undefined
        }
      };
    } catch (error) {
      throw new Error(`Error deleting lab part: ${(error as Error).message}`);
    }
  }

  /**
   * Get labs by course ID
   */
  static async getLabsByCourse(courseId: string, page: number = 1, limit: number = 10) {
    try {
      const skip = (page - 1) * limit;

      const [labs, total] = await Promise.all([
        LabModel.find({ courseId })
          .skip(skip)
          .limit(limit)
          .sort({ createdAt: -1 })
          .lean(),
        LabModel.countDocuments({ courseId })
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
        totalParts,
        totalPoints,
        avgPointsPerLab
      ] = await Promise.all([
        LabModel.countDocuments(filter),
        LabModel.aggregate([
          { $match: filter },
          { $unwind: "$parts" },
          { $count: "total" }
        ]).then(result => result[0]?.total || 0),
        LabModel.aggregate([
          { $match: filter },
          { $unwind: "$parts" },
          { $group: { _id: null, total: { $sum: "$parts.total_points" } } }
        ]).then(result => result[0]?.total || 0),
        LabModel.aggregate([
          { $match: filter },
          { $unwind: "$parts" },
          { $group: { _id: "$_id", labPoints: { $sum: "$parts.total_points" } } },
          { $group: { _id: null, avgPoints: { $avg: "$labPoints" } } }
        ]).then(result => Math.round(result[0]?.avgPoints || 0))
      ]);

      return {
        totalLabs,
        totalParts,
        totalPoints,
        avgPointsPerLab
      };
    } catch (error) {
      throw new Error(`Error fetching lab statistics: ${(error as Error).message}`);
    }
  }
}
