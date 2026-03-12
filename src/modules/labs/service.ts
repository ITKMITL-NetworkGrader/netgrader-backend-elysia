import { Lab, ILab } from "./model";
import { getDateWithTimezone } from "../../utils/helpers";
import { env } from "process";
import { Types } from "mongoose";
import { ObjectId } from "mongodb";
import { User } from "../auth/model";
import { processRichContent } from "../../utils/rich-content";
import { LabPart } from "../parts/model";
import { Submission } from "../submissions/model";
import crypto from 'crypto';

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

      let processedInstructions;
      if (labData.instructions) {
        if (typeof labData.instructions === 'string') {
          processedInstructions = processRichContent(labData.instructions, { type: 'doc', content: [] });
        } else if (typeof labData.instructions.html === 'string' && labData.instructions.json !== undefined) {
          processedInstructions = processRichContent(
            labData.instructions.html,
            labData.instructions.json
          );
        }
      }

      const newLab = new Lab({
        courseId: new ObjectId(labData.courseId),
        title: labData.title,
        description: labData.description,
        type: labData.type || 'lab',
        network: labData.network,
        createdBy: user._id,
        // Auto-publish lab if publishedAt is not explicitly set
        // This allows immediate access unless instructor explicitly unpublishes
        publishedAt: labData.publishedAt !== undefined ? labData.publishedAt : new Date(),
        availableFrom: labData.availableFrom,
        availableUntil: labData.availableUntil,
        dueDate: labData.dueDate,
        latePenaltyPercent: labData.latePenaltyPercent,
        instructions: processedInstructions
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
      const { courseId, createdBy, type, page = 1, limit = 20 } = filters;
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
      const allowedFields = ['title', 'description', 'type', 'courseId', 'network', 'publishedAt', 'availableFrom', 'availableUntil', 'dueDate', 'latePenaltyPercent', 'instructions'];
      const updateFields: any = {};

      allowedFields.forEach(field => {
        if (filteredData[field] !== undefined) {
          if (field === 'instructions') {
            const instructionsPayload: any = filteredData.instructions;
            if (!instructionsPayload) {
              updateFields.instructions = undefined;
            } else if (typeof instructionsPayload === 'string') {
              updateFields.instructions = processRichContent(instructionsPayload, { type: 'doc', content: [] });
            } else {
              // Safely check object shape before accessing properties
              const ip = instructionsPayload as any;
              if (ip && typeof ip === 'object' && typeof ip.html === 'string' && ip.json !== undefined) {
                updateFields.instructions = processRichContent(
                  ip.html,
                  ip.json
                );
              } else {
                // Fallback: preserve provided object (or adjust as needed)
                updateFields.instructions = instructionsPayload;
              }
            }
          } else {
            updateFields[field] = filteredData[field];
          }
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

      // IP cache no longer used - removed IpAllocationService

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
   * Cascades delete to all related lab parts and their submissions
   */
  static async deleteLab(id: string) {
    try {
      // First, find all lab parts for this lab
      const labParts = await LabPart.find({ labId: id });

      let totalSubmissionsDeleted = 0;
      let totalPartsDeleted = 0;

      // Delete all submissions for each part
      for (const part of labParts) {
        const submissionDeletionResult = await Submission.deleteMany({
          labId: part.labId,
          partId: part.partId
        });
        totalSubmissionsDeleted += submissionDeletionResult.deletedCount;
      }

      // Delete all lab parts for this lab
      const partDeletionResult = await LabPart.deleteMany({ labId: id });
      totalPartsDeleted = partDeletionResult.deletedCount;

      console.log(`🗑️  Cascade delete for lab ${id}:`);
      console.log(`   - Deleted ${totalPartsDeleted} lab parts`);
      console.log(`   - Deleted ${totalSubmissionsDeleted} submissions`);

      // Finally, delete the lab itself
      const deletedLab = await Lab.findByIdAndDelete(id);

      if (!deletedLab) {
        return null;
      }

      // IP cache no longer used - removed IpAllocationService

      return {
        ...deletedLab.toObject(),
        id: deletedLab._id?.toString(),
        _id: undefined,
        deletionStats: {
          partsDeleted: totalPartsDeleted,
          submissionsDeleted: totalSubmissionsDeleted
        }
      };
    } catch (error) {
      throw new Error(`Error deleting lab: ${(error as Error).message}`);
    }
  }

  /**
   * Get labs by course ID
   */
  static async getLabsByCourse(courseId: string, page: number = 1, limit: number = 20) {
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

  /**
   * Duplicate a lab to another course (or same course)
   * @param sourceLabId - The lab ID to duplicate
   * @param targetCourseId - The destination course ID (can be same as source)
   * @param newTitle - Optional new title for the duplicated lab
   * @param includeParts - Whether to duplicate parts (default: true)
   * @param createdBy - The user ID creating the duplicate
   */
  static async duplicateLab(
    sourceLabId: string,
    targetCourseId: string,
    createdBy: string,
    newTitle?: string,
    includeParts: boolean = true
  ) {
    try {
      // Find user by u_id and get their MongoDB _id
      const user = await User.findOne({ u_id: createdBy });
      if (!user) {
        throw new Error(`User not found with u_id: ${createdBy}`);
      }

      // Get source lab
      const sourceLab = await Lab.findById(sourceLabId).lean();
      if (!sourceLab) {
        throw new Error(`Source lab with ID ${sourceLabId} not found`);
      }

      // Deep clone the lab object, excluding metadata fields
      const labClone: any = JSON.parse(JSON.stringify(sourceLab));
      delete labClone._id;
      delete labClone.createdAt;
      delete labClone.updatedAt;

      // Set new values
      labClone.courseId = new ObjectId(targetCourseId);
      labClone.title = newTitle || `Copy of ${sourceLab.title}`;
      labClone.createdBy = user._id;
      labClone.publishedAt = null; // Unpublish by default

      // Create the new lab
      const newLab = new Lab(labClone);
      const savedLab = await newLab.save();

      let duplicatedParts: any[] = [];

      // Duplicate parts if requested
      if (includeParts) {
        const sourceParts = await LabPart.find({ labId: sourceLabId }).lean();

        for (const part of sourceParts) {
          // Deep clone the part
          const partClone: any = JSON.parse(JSON.stringify(part));
          delete partClone._id;
          delete partClone.createdAt;
          delete partClone.updatedAt;

          // Update labId to new lab
          partClone.labId = savedLab._id;

          // DSEC-03: Generate new task IDs using cryptographically secure random bytes
          if (partClone.tasks && Array.isArray(partClone.tasks)) {
            partClone.tasks = partClone.tasks.map((task: any) => ({
              ...task,
              taskId: `task_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`
            }));
          }

          // Update metadata
          partClone.metadata = {
            ...partClone.metadata,
            lastModified: new Date(),
            version: 1
          };

          const newPart = new LabPart(partClone);
          const savedPart = await newPart.save();
          duplicatedParts.push({
            id: savedPart._id?.toString(),
            partId: savedPart.partId,
            title: savedPart.title,
            order: savedPart.order
          });
        }
      }

      return {
        success: true,
        duplicatedLab: {
          id: savedLab._id?.toString(),
          title: savedLab.title,
          courseId: savedLab.courseId?.toString(),
          sourceLabId: sourceLabId,
          type: savedLab.type
        },
        parts: {
          count: duplicatedParts.length,
          items: duplicatedParts
        }
      };
    } catch (error) {
      throw new Error(`Error duplicating lab: ${(error as Error).message}`);
    }
  }
}
