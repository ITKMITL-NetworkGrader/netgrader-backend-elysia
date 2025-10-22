import { LabPart, ILabPart } from "./model";
import { Lab } from "../labs/model";
import { Submission } from "../submissions/model";
import { Types } from "mongoose";
import { processRichContent, estimateReadingTime } from "../../utils/rich-content";

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

      // Validate IP Table Questionnaire - reject management interfaces
      if (partData.partType === 'fill_in_blank' && Array.isArray(partData.questions)) {
        for (const question of partData.questions) {
          if (question.questionType === 'ip_table_questionnaire' && question.ipTableQuestionnaire) {
            const cells = question.ipTableQuestionnaire.cells || [];
            let questionPoints = 0;

            for (let rowIndex = 0; rowIndex < cells.length; rowIndex++) {
              const row = cells[rowIndex] || [];

              for (let colIndex = 0; colIndex < row.length; colIndex++) {
                const originalCell = row[colIndex] || {};
                const cellType = originalCell.cellType || 'input';
                const cell: any = {
                  ...originalCell,
                  cellType
                };

                if (cellType === 'input') {
                  const answerType = cell.answerType || 'calculated';

                  if (answerType !== 'static' && answerType !== 'calculated') {
                    throw new Error(
                      `Invalid IP Table configuration: Input cell [${rowIndex + 1}, ${colIndex + 1}] must use answerType "static" or "calculated".`
                    );
                  }

                  cell.answerType = answerType;
                  cell.readonlyContent = undefined;
                  cell.blankReason = undefined;

                  if (answerType === 'static') {
                    if (!cell.staticAnswer || typeof cell.staticAnswer !== 'string' || !cell.staticAnswer.trim()) {
                      throw new Error(
                        `Invalid IP Table configuration: Static input cell [${rowIndex + 1}, ${colIndex + 1}] must include a non-empty static answer.`
                      );
                    }
                    cell.calculatedAnswer = undefined;
                  } else {
                    if (!cell.calculatedAnswer) {
                      throw new Error(
                        `Invalid IP Table configuration: Calculated input cell [${rowIndex + 1}, ${colIndex + 1}] is missing calculatedAnswer configuration.`
                      );
                    }
                    cell.staticAnswer = undefined;

                    if (cell.calculatedAnswer.calculationType === 'device_interface_ip') {
                      const { deviceId, interfaceName } = cell.calculatedAnswer;

                      if (deviceId && interfaceName) {
                        const device = labExists.network?.devices?.find((d: any) => d.deviceId === deviceId);
                        if (device) {
                          const ipVar = device.ipVariables?.find((v: any) => v.name === interfaceName);
                          if (ipVar?.isManagementInterface) {
                            throw new Error(
                              `Invalid IP Table configuration: Cell [${rowIndex + 1}, ${colIndex + 1}] uses management interface ` +
                              `${deviceId}.${interfaceName}. Management interfaces cannot be used in IP questionnaires ` +
                              `because they are auto-generated. Please remove this cell or use a different interface.`
                            );
                          }
                        }
                      }
                    }
                  }

                  const normalizedPoints = typeof cell.points === 'number' && !Number.isNaN(cell.points)
                    ? cell.points
                    : 0;
                  cell.points = normalizedPoints >= 1 ? normalizedPoints : 1;
                  cell.autoCalculated = Boolean(cell.autoCalculated);
                  questionPoints += cell.points;
                } else if (cellType === 'readonly') {
                  const readonlyContent = (cell.readonlyContent ?? '').toString().trim();

                  if (!readonlyContent) {
                    throw new Error(
                      `Invalid IP Table configuration: Read-only cell [${rowIndex + 1}, ${colIndex + 1}] must include readonlyContent.`
                    );
                  }

                  cell.readonlyContent = readonlyContent;
                  cell.answerType = undefined;
                  cell.staticAnswer = undefined;
                  cell.calculatedAnswer = undefined;
                  cell.points = 0;
                  cell.autoCalculated = false;
                  cell.blankReason = undefined;
                } else {
                  // Blank cell
                  cell.answerType = undefined;
                  cell.staticAnswer = undefined;
                  cell.calculatedAnswer = undefined;
                  cell.points = 0;
                  cell.autoCalculated = false;
                  cell.readonlyContent = undefined;
                  cell.blankReason = (cell.blankReason ?? '').toString().trim();
                }

                row[colIndex] = cell;
              }
            }

            question.ipTableQuestionnaire.cells = cells;
            question.points = questionPoints;
          }
        }
      }

      // Process rich content for instructions only
      let processedInstructions;
      
      if (typeof partData.instructions === 'string') {
        // Backward compatibility: convert plain HTML string to rich content
        processedInstructions = {
          html: partData.instructions,
          json: { type: 'doc', content: [] }, // Empty TipTap JSON
          plainText: partData.instructions.replace(/<[^>]*>/g, '').trim(),
          metadata: {
            wordCount: 0,
            characterCount: partData.instructions.length,
            estimatedReadingTime: 1,
            lastModified: new Date(),
            hasImages: partData.instructions.includes('<img'),
            hasCodeBlocks: partData.instructions.includes('<code>') || partData.instructions.includes('<pre>'),
            headingStructure: []
          }
        };
      } else {
        // New format: process rich content normally
        processedInstructions = processRichContent(
          partData.instructions.html,
          partData.instructions.json
        );
      }

      const newPart = new LabPart({
        labId: partData.labId,
        partId: partData.partId,
        title: partData.title,
        description: partData.description || "",
        instructions: processedInstructions,
        order: partData.order,
        partType: partData.partType || 'network_config',
        questions: partData.questions || [],
        dhcpConfiguration: partData.dhcpConfiguration,
        tasks: (partData.tasks || []).map((task: any) => ({
          ...task,
          description: task.description || ""
        })),
        task_groups: (partData.task_groups || []).map((group: any) => ({
          ...group,
          description: group.description || ""
        })),
        prerequisites: (partData.prerequisites || []).filter((prereq: string) => prereq && prereq.trim() !== ''),
        totalPoints: partData.totalPoints,
        metadata: {
          wordCount: processedInstructions.metadata.wordCount,
          estimatedReadingTime: processedInstructions.metadata.estimatedReadingTime,
          lastModified: new Date(),
          version: 1
        }
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
          } else if (field === 'instructions' && filteredData[field]) {
            // Process rich content for instructions
            if (typeof filteredData[field] === 'string') {
              // Backward compatibility: convert plain HTML string to rich content
              updateFields[field] = {
                html: filteredData[field] as string,
                json: { type: 'doc', content: [] },
                plainText: (filteredData[field] as string).replace(/<[^>]*>/g, '').trim(),
                metadata: {
                  wordCount: 0,
                  characterCount: (filteredData[field] as string).length,
                  estimatedReadingTime: 1,
                  lastModified: new Date(),
                  hasImages: (filteredData[field] as string).includes('<img'),
                  hasCodeBlocks: (filteredData[field] as string).includes('<code>') || (filteredData[field] as string).includes('<pre>'),
                  headingStructure: []
                }
              };
            } else {
              // New format: process rich content normally
              const richContent = filteredData[field] as { html: string; json: any };
              updateFields[field] = processRichContent(
                richContent.html,
                richContent.json
              );
            }
          } else if (field === 'tasks' && Array.isArray(filteredData[field])) {
            // Ensure task descriptions have default empty strings
            updateFields[field] = filteredData[field].map((task: any) => ({
              ...task,
              description: task.description || ""
            }));
          } else if (field === 'task_groups' && Array.isArray(filteredData[field])) {
            // Ensure task group descriptions have default empty strings
            updateFields[field] = filteredData[field].map((group: any) => ({
              ...group,
              description: group.description || ""
            }));
          } else {
            updateFields[field] = filteredData[field];
          }
        }
      });

      // Update metadata if content changed
      if (updateFields.instructions || updateFields.description || updateFields.tasks || updateFields.task_groups) {
        const currentPart = await LabPart.findById(id);
        if (currentPart) {
          const instructionsWordCount = updateFields.instructions?.metadata?.wordCount || (currentPart.instructions as any)?.metadata?.wordCount || 0;
          
          updateFields.metadata = {
            ...(currentPart.metadata || {}),
            wordCount: instructionsWordCount,
            estimatedReadingTime: estimateReadingTime(instructionsWordCount),
            lastModified: new Date(),
            version: ((currentPart.metadata as any)?.version || 1) + 1
          };
        }
      }

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
        labId: updatedPart.labId?.toString(),
        prerequisites: updatedPart.prerequisites?.filter(prereq => prereq && prereq.trim() !== '') || [],
        _id: undefined
      };
    } catch (error) {
      throw new Error(`Error updating part: ${(error as Error).message}`);
    }
  }

  /**
   * Delete part by ID
   * Also cascades delete to all submissions for this part
   */
  static async deletePart(id: string) {
    try {
      // First, find the part to get its partId for submission deletion
      const part = await LabPart.findById(id);

      if (!part) {
        return null;
      }

      // Cascade delete: Remove all submissions for this part
      // Submissions reference partId (string), not the MongoDB _id
      const deletionResult = await Submission.deleteMany({
        labId: part.labId,
        partId: part.partId
      });

      console.log(`🗑️  Cascade delete: Removed ${deletionResult.deletedCount} submissions for part ${part.partId}`);

      // Now delete the part itself
      const deletedPart = await LabPart.findByIdAndDelete(id);

      return {
        ...deletedPart!.toObject(),
        id: deletedPart!._id?.toString(),
        prerequisites: deletedPart!.prerequisites?.filter(prereq => prereq && prereq.trim() !== '') || [],
        labId: deletedPart!.labId?.toString(),
        _id: undefined,
        // Include deletion stats in response
        deletionStats: {
          submissionsDeleted: deletionResult.deletedCount
        }
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

  /**
   * Auto-save functionality for rich content
   */
  static async autoSavePart(partId: string, labId: string, content: any, field: string) {
    try {
      const processedContent = processRichContent(content.html, content.json);

      const autoSaveData = {
        [`metadata.autoSave.${field}`]: processedContent,
        'metadata.autoSave.timestamp': new Date()
      };

      await LabPart.updateOne(
        { _id: partId, labId: labId },
        { $set: autoSaveData }
      );

      return {
        success: true,
        timestamp: new Date(),
        wordCount: processedContent.metadata.wordCount
      };
    } catch (error) {
      throw new Error(`Auto-save failed: ${(error as Error).message}`);
    }
  }

  /**
   * Load auto-saved content
   */
  static async loadAutoSave(partId: string, labId: string, field: string) {
    try {
      const projection = {
        [`metadata.autoSave.${field}`]: 1,
        'metadata.autoSave.timestamp': 1
      } as Record<string, 1>;
      
      const part = await LabPart.findOne(
        { _id: partId, labId: labId },
        projection
      );

      if (!part || !part.metadata?.autoSave) {
        return {
          success: false,
          message: 'No auto-save data found'
        };
      }

      const autoSaveData = (part.metadata.autoSave as any)[field];
      const timestamp = part.metadata.autoSave.timestamp;

      if (!autoSaveData) {
        return {
          success: false,
          message: `No auto-save data found for field: ${field}`
        };
      }

      return {
        success: true,
        content: autoSaveData,
        timestamp: timestamp,
        wordCount: autoSaveData.metadata?.wordCount || 0
      };
    } catch (error) {
      throw new Error(`Failed to load auto-save: ${(error as Error).message}`);
    }
  }

  /**
   * Get part with auto-save status
   */
  static async getPartWithAutoSave(partId: string, labId: string) {
    try {
      const part = await LabPart.findOne({ _id: partId, labId: labId }).lean();
      
      if (!part) {
        return null;
      }

      const hasAutoSave = part.metadata?.autoSave && Object.keys(part.metadata.autoSave).length > 1; // more than just timestamp
      const autoSaveTimestamp = part.metadata?.autoSave?.timestamp;
      const lastModified = part.metadata?.lastModified;
      
      const isAutoSaveNewer = hasAutoSave && autoSaveTimestamp && lastModified && 
        new Date(autoSaveTimestamp) > new Date(lastModified);

      return {
        ...part,
        id: part._id?.toString(),
        labId: part.labId?.toString(),
        prerequisites: part.prerequisites?.filter(prereq => prereq && prereq.trim() !== '') || [],
        _id: undefined,
        autoSaveStatus: {
          hasAutoSave,
          isAutoSaveNewer,
          autoSaveTimestamp,
          lastModified
        }
      };
    } catch (error) {
      throw new Error(`Error fetching part with auto-save: ${(error as Error).message}`);
    }
  }

  /**
   * Clean up unused assets
   */
  static async cleanupAssets(partId: string, labId: string, currentAssets: string[]) {
    try {
      // Get current part
      const part = await LabPart.findOne({ _id: partId, labId: labId });

      if (!part) {
        throw new Error('Part not found');
      }

      // Find assets that are no longer referenced
      const existingAssets = part.assets || [];
      const unusedAssets = existingAssets.filter(
        (asset: any) => !currentAssets.includes(asset.id)
      );

      // Remove unused assets from database
      if (unusedAssets.length > 0) {
        await LabPart.updateOne(
          { _id: partId, labId: labId },
          { $pull: { assets: { id: { $in: unusedAssets.map((a: any) => a.id) } } } }
        );

        // TODO: Delete files from MinIO/storage
        // await deleteAssetsFromStorage(unusedAssets)
      }

      return {
        success: true,
        cleanedAssets: unusedAssets.length
      };
    } catch (error) {
      throw new Error(`Asset cleanup failed: ${(error as Error).message}`);
    }
  }
}
