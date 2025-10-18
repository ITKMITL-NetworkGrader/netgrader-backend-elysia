/**
 * Student IP Schema Service
 *
 * Handles creation, updates, and validation of student IP schemas
 */

import { Types } from 'mongoose';
import { StudentIpSchema, IStudentIpSchema } from './model';
import { LabPart, ILabPart } from '../parts/model';
import { Lab, ILab } from '../labs/model';
import {
  ipToNumber,
  isIpInRange,
  constructDhcpIp,
  isValidIpAddress
} from './ip-calculation.service';
import { validateIpTableQuestionnaire, TableValidationResult } from './ip-table-validation.service';

export interface SubmitAnswersRequest {
  answers: Array<{
    questionId: string;
    answer?: string;  // For simple questions
    tableAnswers?: string[][];  // For IP table questionnaires
  }>;
  isUpdate: boolean;
}

export interface QuestionValidationResult {
  questionId: string;
  isCorrect: boolean;
  pointsEarned: number;
  correctAnswer?: string;  // Only show if incorrect
  feedback?: string;
  cellResults?: any[][];  // For IP table questionnaires
}

export interface SubmitAnswersResponse {
  results: QuestionValidationResult[];
  totalPoints: number;
  totalPointsEarned: number;
  passed: boolean;
  studentIpSchema: {
    schemaId: string;
    version: number;
    schema: IStudentIpSchema['schema'];
  };
  message: string;
}

export class StudentIpSchemaService {
  /**
   * Submit or update IP calculation answers
   *
   * @param studentId - Student's user ID
   * @param labId - Lab ID
   * @param partId - Part ID
   * @param request - Submit answers request
   * @returns Submission response with validation results
   */
  static async submitAnswers(
    studentId: Types.ObjectId,
    labId: Types.ObjectId,
    partId: Types.ObjectId,
    request: SubmitAnswersRequest
  ): Promise<SubmitAnswersResponse> {
    const { answers, isUpdate } = request;

    // 1. Get lab part with questions
    const labPart = await LabPart.findOne({ _id: partId, labId });
    if (!labPart || labPart.partType !== 'fill_in_blank') {
      throw new Error('Part is not fill-in-blank type');
    }

    if (!labPart.questions || labPart.questions.length === 0) {
      throw new Error('Part has no questions');
    }

    // 2. Validate all questions are answered
    const answeredQuestionIds = new Set(answers.map(a => a.questionId));
    const missingQuestions = labPart.questions.filter(
      q => !answeredQuestionIds.has(q.questionId)
    );
    if (missingQuestions.length > 0) {
      throw new Error(
        `Missing answers for: ${missingQuestions.map(q => q.questionId).join(', ')}`
      );
    }

    // 2a. Validate answer format (table vs simple)
    for (const answer of answers) {
      const question = labPart.questions.find(q => q.questionId === answer.questionId);
      if (!question) continue;

      if (question.questionType === 'ip_table_questionnaire') {
        if (!answer.tableAnswers) {
          throw new Error(
            `Question ${answer.questionId} requires tableAnswers field`
          );
        }

        if (!question.ipTableQuestionnaire) {
          throw new Error(`Question ${answer.questionId} missing ipTableQuestionnaire data`);
        }

        const expectedRows = question.ipTableQuestionnaire.rowCount;
        const expectedCols = question.ipTableQuestionnaire.columnCount;

        if (answer.tableAnswers.length !== expectedRows) {
          throw new Error(
            `Expected ${expectedRows} rows but got ${answer.tableAnswers.length}`
          );
        }

        for (let i = 0; i < answer.tableAnswers.length; i++) {
          if (answer.tableAnswers[i].length !== expectedCols) {
            throw new Error(
              `Row ${i} expected ${expectedCols} columns but got ${answer.tableAnswers[i].length}`
            );
          }
        }

        // Validate each cell is not empty
        for (let rowIdx = 0; rowIdx < answer.tableAnswers.length; rowIdx++) {
          for (let colIdx = 0; colIdx < answer.tableAnswers[rowIdx].length; colIdx++) {
            const cellAnswer = answer.tableAnswers[rowIdx][colIdx];
            if (!cellAnswer || !cellAnswer.trim()) {
              throw new Error(
                `Cell [${rowIdx + 1}, ${colIdx + 1}] cannot be empty`
              );
            }
          }
        }
      } else {
        if (answer.answer === undefined && answer.answer !== '') {
          throw new Error(
            `Question ${answer.questionId} requires answer field`
          );
        }
      }
    }

    // 3. Get lab for DHCP validation
    const lab = await Lab.findById(labId);
    if (!lab) {
      throw new Error('Lab not found');
    }

    // 4. Check for DHCP range validation (if updating and part has DHCP config)
    const dhcpPart = await LabPart.findOne({
      labId,
      partType: 'dhcp_config'
    });

    if (dhcpPart?.dhcpConfiguration) {
      // Validate device IPs are within lecturer-defined range
      for (const answer of answers) {
        const question = labPart.questions.find(q => q.questionId === answer.questionId);
        if (question?.schemaMapping?.deviceId && answer.answer) {
          const vlan = lab.network.vlanConfiguration?.vlans[dhcpPart.dhcpConfiguration.vlanIndex];
          if (!vlan) {
            throw new Error(`VLAN ${dhcpPart.dhcpConfiguration.vlanIndex} not found`);
          }

          const startIp = constructDhcpIp(vlan.baseNetwork, dhcpPart.dhcpConfiguration.startOffset);
          const endIp = constructDhcpIp(vlan.baseNetwork, dhcpPart.dhcpConfiguration.endOffset);

          const isValid = isIpInRange(answer.answer, startIp, endIp);
          if (!isValid) {
            throw new Error(
              `IP ${answer.answer} is outside the DHCP IP range (${startIp} - ${endIp})`
            );
          }
        }
      }
    }

    // 5. Map answers to schema structure
    const schema = this.mapAnswersToSchema(answers, labPart.questions);

    // 6. Create or update StudentIpSchema
    let studentSchema: IStudentIpSchema;

    if (!isUpdate) {
      // Create new schema (version 1)
      studentSchema = await StudentIpSchema.create({
        studentId,
        labId,
        schema,
        version: 1,
        calculationPartId: partId,
        isLocked: false
      });
    } else {
      // Update existing schema (increment version)
      const existingSchema = await StudentIpSchema.findOne({
        studentId,
        labId
      }).sort({ version: -1 });

      if (!existingSchema) {
        throw new Error('No existing schema to update');
      }

      // Create new version
      studentSchema = await StudentIpSchema.create({
        studentId,
        labId,
        schema,
        version: existingSchema.version + 1,
        previousVersionId: existingSchema._id,
        calculationPartId: partId,
        isLocked: false
      });
    }

    // 7. Validate answers and calculate points
    const results = await this.validateAnswers(answers, labPart.questions, lab, studentSchema);
    const totalPointsEarned = results.reduce((sum, r) => sum + r.pointsEarned, 0);
    const totalPoints = labPart.questions.reduce((sum, q) => sum + q.points, 0);

    // 8. Return response
    return {
      results,
      totalPoints,
      totalPointsEarned,
      passed: totalPointsEarned >= totalPoints * 0.7, // 70% passing threshold
      studentIpSchema: {
        schemaId: String(studentSchema._id),
        version: studentSchema.version,
        schema: studentSchema.schema
      },
      message: isUpdate ? 'IP Schema updated successfully' : 'IP Schema created successfully'
    };
  }

  /**
   * Get latest IP schema for a student in a lab
   *
   * @param studentId - Student's user ID
   * @param labId - Lab ID
   * @returns Student IP schema or null if not found
   */
  static async getLatestSchema(
    studentId: Types.ObjectId,
    labId: Types.ObjectId
  ): Promise<IStudentIpSchema | null> {
    return await StudentIpSchema.findOne({ studentId, labId })
      .sort({ version: -1 })
      .exec();
  }

  /**
   * Get all schema versions for a student in a lab
   *
   * @param studentId - Student's user ID
   * @param labId - Lab ID
   * @returns Array of student IP schemas, sorted by version descending
   */
  static async getAllSchemaVersions(
    studentId: Types.ObjectId,
    labId: Types.ObjectId
  ): Promise<IStudentIpSchema[]> {
    return await StudentIpSchema.find({ studentId, labId })
      .sort({ version: -1 })
      .exec();
  }

  /**
   * Map answers to schema structure
   *
   * @param answers - Student answers
   * @param questions - Question definitions
   * @returns Schema structure
   */
  private static mapAnswersToSchema(
    answers: Array<{ questionId: string; answer?: string; tableAnswers?: string[][] }>,
    questions: ILabPart['questions'] | undefined
  ): IStudentIpSchema['schema'] {
    if (!questions) {
      return { vlans: [], devices: [] };
    }
    const schema: IStudentIpSchema['schema'] = {
      vlans: [],
      devices: []
    };

    const vlanMap = new Map<number, any>();
    const deviceMap = new Map<string, any>();

    for (const answer of answers) {
      const question = questions.find(q => q.questionId === answer.questionId);
      if (!question) continue;

      // Skip questions without schemaMapping (custom_text and ip_table_questionnaire)
      if (!question.schemaMapping) {
        continue;
      }

      if (!answer.answer) {
        continue;  // Skip table answers for now
      }

      const { vlanIndex, field, deviceId, variableName } = question.schemaMapping;

      if (deviceId && variableName) {
        // Device-level IP
        if (!deviceMap.has(deviceId)) {
          deviceMap.set(deviceId, {
            deviceId,
            interfaces: []
          });
        }
        deviceMap.get(deviceId).interfaces.push({
          variableName,
          ipAddress: answer.answer,
          source: 'calculated',
          updatedAt: new Date(),
          updatedBy: 'initial_calculation'
        });
      } else {
        // VLAN-level field
        if (!vlanMap.has(vlanIndex)) {
          vlanMap.set(vlanIndex, {
            vlanIndex,
            source: 'calculated',
            updatedAt: new Date()
          });
        }
        vlanMap.get(vlanIndex)[field] = answer.answer;
      }
    }

    schema.vlans = Array.from(vlanMap.values());
    schema.devices = Array.from(deviceMap.values());

    return schema;
  }

  /**
   * Validate answers against expected values
   *
   * @param answers - Student answers
   * @param questions - Question definitions
   * @param lab - Lab configuration
   * @param studentSchema - Student IP schema
   * @returns Validation results
   */
  private static async validateAnswers(
    answers: Array<{ questionId: string; answer?: string; tableAnswers?: string[][] }>,
    questions: ILabPart['questions'] | undefined,
    lab: ILab,
    studentSchema: IStudentIpSchema
  ): Promise<QuestionValidationResult[]> {
    const results: QuestionValidationResult[] = [];

    if (!questions) {
      return results;
    }

    for (const answer of answers) {
      const question = questions.find(q => q.questionId === answer.questionId);
      if (!question) continue;

      if (question.questionType === 'ip_table_questionnaire' && answer.tableAnswers) {
        // Validate IP table questionnaire
        const tableResult = validateIpTableQuestionnaire(
          answer.questionId,
          answer.tableAnswers,
          question,
          lab,
          studentSchema
        );

        results.push({
          questionId: tableResult.questionId,
          isCorrect: tableResult.isCorrect,
          pointsEarned: tableResult.pointsEarned,
          feedback: tableResult.feedback,
          cellResults: tableResult.cellResults
        });
      } else if (question.questionType === 'custom_text' && answer.answer !== undefined) {
        // Validate custom text question
        const isCorrect = this.validateCustomText(
          answer.answer,
          question.expectedAnswer || '',
          question.caseSensitive || false,
          question.trimWhitespace !== false
        );

        results.push({
          questionId: answer.questionId,
          isCorrect,
          pointsEarned: isCorrect ? question.points : 0,
          correctAnswer: isCorrect ? undefined : question.expectedAnswer
        });
      } else {
        // For other question types, we mark them as correct
        // (actual validation would require expected answer calculation)
        // This is a placeholder for now
        results.push({
          questionId: answer.questionId,
          isCorrect: true,
          pointsEarned: question.points
        });
      }
    }

    return results;
  }

  /**
   * Validate custom text answer
   *
   * @param studentAnswer - Student's answer
   * @param expectedAnswer - Expected answer
   * @param caseSensitive - Whether comparison is case-sensitive
   * @param trimWhitespace - Whether to trim whitespace
   * @returns true if answer is correct
   */
  private static validateCustomText(
    studentAnswer: string,
    expectedAnswer: string,
    caseSensitive: boolean,
    trimWhitespace: boolean
  ): boolean {
    let student = studentAnswer;
    let expected = expectedAnswer;

    if (trimWhitespace) {
      student = student.trim();
      expected = expected.trim();
    }

    if (!caseSensitive) {
      student = student.toLowerCase();
      expected = expected.toLowerCase();
    }

    return student === expected;
  }

  /**
   * Submit DHCP configuration completion
   *
   * @param studentId - Student's user ID
   * @param labId - Lab ID
   * @param partId - Part ID
   * @param vlanIndex - VLAN index for DHCP configuration
   * @returns Completion result
   */
  static async submitCompletion(
    studentId: Types.ObjectId,
    labId: Types.ObjectId,
    partId: Types.ObjectId,
    vlanIndex: number
  ): Promise<{
    completed: boolean;
    pointsEarned: number;
    message: string;
  }> {
    // 1. Get DHCP part
    const labPart = await LabPart.findOne({ _id: partId, labId });
    if (!labPart || labPart.partType !== 'dhcp_config') {
      throw new Error('Part is not DHCP config type');
    }

    // 2. Verify student has updated their schema
    const schema = await StudentIpSchema.findOne({
      studentId,
      labId
    }).sort({ version: -1 });

    if (!schema || schema.version < 2) {
      throw new Error(
        'You must update your IP schema before submitting DHCP completion'
      );
    }

    // 3. Return completion result
    // Note: Actual submission recording should be handled by the submissions module
    // This endpoint primarily validates that the student has completed the prerequisites
    const pointsEarned = labPart.totalPoints || 10;

    return {
      completed: true,
      pointsEarned,
      message: 'DHCP configuration submitted successfully'
    };
  }
}
