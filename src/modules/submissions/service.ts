import { Types } from 'mongoose';
import { Submission, ISubmission, IGradingResult, IProgressUpdate, IFillInBlankResults } from './model';
import { StudentLabSessionService } from '../student-lab-sessions/service';
import { StudentLabSession } from '../student-lab-sessions/model';
import { PartService } from '../parts/service';

export class SubmissionService {
  private static async getNextAttempt(
    studentId: string,
    labId: Types.ObjectId,
    partId: string
  ): Promise<number> {
    const latestSubmission = await Submission.findOne({
      studentId,
      labId,
      partId,
      submissionType: { $ne: 'ip_answers' } // ip_answers submissions do not count toward attempts
    }).sort({ attempt: -1 });

    return latestSubmission ? latestSubmission.attempt + 1 : 1;
  }

  /**
   * Create a new submission record or increment attempt for existing student/lab/part
   */
  static async createSubmission(data: {
    jobId: string;
    studentId: string;
    labId: string | Types.ObjectId;
    partId: string;
    ipMappings: Record<string, string>;
    attempt?: number;
    labSessionId?: string | Types.ObjectId;
    labAttemptNumber?: number;
  }): Promise<ISubmission> {
    const labObjectId = new Types.ObjectId(data.labId);
    const nextAttempt = await this.getNextAttempt(data.studentId, labObjectId, data.partId);
    let labSessionObjectId: Types.ObjectId | undefined;

    if (data.labSessionId) {
      labSessionObjectId = data.labSessionId instanceof Types.ObjectId
        ? data.labSessionId
        : new Types.ObjectId(data.labSessionId);
    }

    const attemptValue = data.attempt ?? nextAttempt;

    const submission = new Submission({
      jobId: data.jobId,
      studentId: data.studentId,
      labId: labObjectId,
      partId: data.partId,
      submissionType: 'auto_grading',
      ipMappings: data.ipMappings,
      attempt: attemptValue,
      labSessionId: labSessionObjectId,
      labAttemptNumber: data.labAttemptNumber,
      status: 'pending',
      progressHistory: []
    });

    return await submission.save();
  }

  /**
   * Update submission status when job starts
   */
  static async markJobStarted(jobId: string): Promise<ISubmission | null> {
    return await Submission.findOneAndUpdate(
      { jobId },
      {
        status: 'running',
        startedAt: new Date()
      },
      { new: true }
    );
  }

  /**
   * Update submission with progress information
   */
  static async updateProgress(jobId: string, progressData: {
    message: string;
    current_test?: string;
    tests_completed: number;
    total_tests: number;
    percentage: number;
  }): Promise<ISubmission | null> {
    const progressUpdate: IProgressUpdate = {
      message: progressData.message,
      current_test: progressData.current_test || '',
      tests_completed: progressData.tests_completed,
      total_tests: progressData.total_tests,
      percentage: progressData.percentage,
      timestamp: new Date()
    };

    return await Submission.findOneAndUpdate(
      { jobId },
      {
        $push: { progressHistory: progressUpdate }
      },
      { new: true }
    );
  }

  /**
   * Store final grading result
   * Releases IP ONLY when ALL parts of the lab are completed with 100% score
   */
  static async storeGradingResult(jobId: string, gradingResult: IGradingResult): Promise<ISubmission | null> {
    const updateData: Partial<ISubmission> = {
      gradingResult,
      completedAt: new Date()
    };

    // Update status based on grading result
    if (gradingResult.status === 'completed') {
      updateData.status = 'completed';
    } else if (gradingResult.status === 'failed') {
      updateData.status = 'failed';
    } else if (gradingResult.status === 'cancelled') {
      updateData.status = 'cancelled';
    }

    const submission = await Submission.findOneAndUpdate(
      { jobId },
      updateData,
      { new: true }
    );

    // Release IP ONLY if ALL parts of the lab are completed with 100%
    if (submission && gradingResult.status === 'completed') {
      const isPerfectScore = gradingResult.total_points_earned === gradingResult.total_points_possible &&
        gradingResult.total_points_possible > 0;

      if (isPerfectScore) {
        try {
          // Check if ALL parts are now 100%
          const allPartsCompleted = await this.areAllPartsCompleted(
            submission.studentId,
            submission.labId as Types.ObjectId,
            { labSessionId: submission.labSessionId ?? null }
          );

          if (allPartsCompleted) {
            // Delete session to release IP
            await StudentLabSessionService.deleteSession(
              submission.studentId,
              submission.labId as Types.ObjectId,
              {
                reason: 'completion',
                completedAt: submission.completedAt ?? new Date()
              }
            );
            console.log(`[Session Released] Student ${submission.studentId} completed ALL parts of lab ${submission.labId} - IP released`);
          } else {
            console.log(`[Session Active] Student ${submission.studentId} completed part ${submission.partId}, but other parts remain - IP kept`);
          }
        } catch (error) {
          console.error('Error checking/releasing student lab session:', error);
          // Don't fail the submission if session deletion fails
        }
      }
    }

    return submission;
  }

  /**
   * Check if student has completed ALL parts of a lab with 100% score
   * Handles multiple submissions per part (checks if at least ONE perfect submission exists per part)
   */
  private static async areAllPartsCompleted(
    studentId: string,
    labId: Types.ObjectId,
    options?: {
      labSessionId?: Types.ObjectId | string | null;
    }
  ): Promise<boolean> {
    try {
      // Get all parts for this lab
      const partsResponse = await PartService.getPartsByLab(labId.toString());
      const totalParts = partsResponse.parts.length;

      if (totalParts === 0) {
        return false; // No parts defined
      }

      const partIds = partsResponse.parts.map(p => p.partId);

      // For EACH part, check if there's at least ONE submission with 100%
      const completedPartIds = new Set<string>();
      let labSessionObjectId: Types.ObjectId | undefined;

      if (options?.labSessionId) {
        labSessionObjectId = options.labSessionId instanceof Types.ObjectId
          ? options.labSessionId
          : new Types.ObjectId(options.labSessionId);
      }

      for (const partId of partIds) {
        const perfectSubmission = await Submission.findOne({
          studentId,
          labId,
          partId,
          status: 'completed',
          ...(labSessionObjectId ? { labSessionId: labSessionObjectId } : {}),
          $expr: {
            $and: [
              { $gt: ['$gradingResult.total_points_possible', 0] },
              { $eq: ['$gradingResult.total_points_earned', '$gradingResult.total_points_possible'] }
            ]
          }
        });

        if (perfectSubmission) {
          completedPartIds.add(partId);
        }
      }

      const allCompleted = completedPartIds.size === totalParts;

      const attemptLabel = labSessionObjectId ? ` (session: ${labSessionObjectId.toString()})` : '';
      console.log(`[Parts Check] Student ${studentId} - Lab ${labId}${attemptLabel}: ${completedPartIds.size}/${totalParts} parts completed`);

      return allCompleted;
    } catch (error) {
      console.error('Error checking if all parts completed:', error);
      return false; // Safe fallback: don't release IP on error
    }
  }

  /**
   * Get submission by job ID
   */
  static async getSubmissionByJobId(jobId: string): Promise<ISubmission | null> {
    return await Submission.findOne({ jobId })
      .populate('studentId', 'name email')
      .populate('labId', 'title description');
  }

  /**
   * Get submissions by student
   */
  static async getSubmissionsByStudent(
    studentId: string,
    options?: {
      labId?: string | Types.ObjectId;
      status?: string;
      limit?: number;
      offset?: number;
      labSessionId?: string | Types.ObjectId | null;
    }
  ): Promise<ISubmission[]> {
    const query: any = { studentId };

    if (options?.labId) {
      query.labId = new Types.ObjectId(options.labId);
    }

    if (options?.status) {
      query.status = options.status;
    }

    if (options?.labSessionId) {
      if (options.labSessionId instanceof Types.ObjectId) {
        query.labSessionId = options.labSessionId;
      } else if (Types.ObjectId.isValid(options.labSessionId)) {
        query.labSessionId = new Types.ObjectId(options.labSessionId);
      } else if (options.labSessionId === 'legacy') {
        query.$or = [
          { labSessionId: { $exists: false } },
          { labSessionId: null }
        ];
      }
    }
    if (options && Object.prototype.hasOwnProperty.call(options, 'labSessionId') && options.labSessionId === null) {
      query.$or = [
        { labSessionId: { $exists: false } },
        { labSessionId: null }
      ];
    }

    return await Submission.find(query)
      .populate('labId', 'title description')
      .sort({ submittedAt: -1 })
      .limit(options?.limit || 50)
      .skip(options?.offset || 0);
  }

  /**
   * Get submissions by lab
   */
  static async getSubmissionsByLab(
    labId: string | Types.ObjectId,
    options?: {
      status?: string;
      limit?: number;
      offset?: number;
    }
  ): Promise<any[]> {
    const matchStage: any = { labId: new Types.ObjectId(labId) };

    if (options?.status) {
      matchStage.status = options.status;
    }

    const submissions = await Submission.aggregate([
      {
        $match: matchStage
      },
      {
        $lookup: {
          from: 'users',
          localField: 'studentId',
          foreignField: 'u_id',
          as: 'studentInfo'
        }
      },
      {
        $unwind: {
          path: '$studentInfo',
          preserveNullAndEmptyArrays: true
        }
      },
      {
        $addFields: {
          studentName: { $ifNull: ['$studentInfo.fullName', 'Unknown Student'] }
        }
      },
      {
        $project: {
          studentInfo: 0 // Remove the full studentInfo object, keep only studentName
        }
      },
      {
        $sort: { submittedAt: -1 }
      },
      {
        $skip: options?.offset || 0
      },
      {
        $limit: options?.limit || 100
      }
    ]);

    return submissions;
  }

  /**
   * Get latest submission for student/lab/part combination
   */
  static async getLatestSubmission(
    studentId: string,
    labId: string | Types.ObjectId,
    partId: string
  ): Promise<ISubmission | null> {
    return await Submission.findOne({
      studentId,
      labId: new Types.ObjectId(labId),
      partId
    })
      .sort({ attempt: -1, submittedAt: -1 })
      .populate('labId', 'title description');
  }

  /**
   * Get submission statistics for a lab
   */
  static async getLabSubmissionStats(labId: string | Types.ObjectId): Promise<{
    total: number;
    completed: number;
    failed: number;
    running: number;
    pending: number;
    averageScore?: number;
  }> {
    const stats = await Submission.aggregate([
      { $match: { labId: new Types.ObjectId(labId) } },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          totalPoints: { $sum: '$gradingResult.total_points_earned' },
          maxPoints: { $sum: '$gradingResult.total_points_possible' }
        }
      }
    ]);

    const result = {
      total: 0,
      completed: 0,
      failed: 0,
      running: 0,
      pending: 0,
      averageScore: undefined as number | undefined
    };

    let totalEarnedPoints = 0;
    let totalPossiblePoints = 0;

    stats.forEach(stat => {
      result.total += stat.count;
      result[stat._id as keyof typeof result] = stat.count;

      if (stat._id === 'completed') {
        totalEarnedPoints += stat.totalPoints || 0;
        totalPossiblePoints += stat.maxPoints || 0;
      }
    });

    if (totalPossiblePoints > 0) {
      result.averageScore = (totalEarnedPoints / totalPossiblePoints) * 100;
    }

    return result;
  }

  /**
   * Get current progress for a submission
   */
  static async getCurrentProgress(jobId: string): Promise<IProgressUpdate | null> {
    const submission = await Submission.findOne({ jobId }).select('progressHistory');

    if (!submission || submission.progressHistory.length === 0) {
      return null;
    }

    return submission.progressHistory[submission.progressHistory.length - 1];
  }

  /**
   * Cancel a submission
   */
  static async cancelSubmission(jobId: string, reason?: string): Promise<ISubmission | null> {
    return await Submission.findOneAndUpdate(
      { jobId, status: { $in: ['pending', 'running'] } },
      {
        status: 'cancelled',
        completedAt: new Date(),
        'gradingResult.cancelled_reason': reason || 'Cancelled by user'
      },
      { new: true }
    );
  }

  /**
   * Delete old submissions (cleanup utility)
   */
  static async deleteOldSubmissions(daysOld: number = 90): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);

    const result = await Submission.deleteMany({
      submittedAt: { $lt: cutoffDate },
      status: { $in: ['completed', 'failed', 'cancelled'] }
    });

    return result.deletedCount;
  }

  /**
   * Get student progression overview for a lab (lightweight for polling)
   * Shows high-level progression: which part students are on and their latest status
   */
  static async getLabSubmissionOverview(
    labId: string | Types.ObjectId,
    options?: {
      limit?: number;
      offset?: number;
    }
  ): Promise<{ data: any[], total: number, limit: number, offset: number }> {
    const labObjectId = new Types.ObjectId(labId);

    // Get total parts for this lab
    const partsResponse = await PartService.getPartsByLab(labId.toString());
    const totalParts = partsResponse.parts.length;

    // Build aggregation pipeline
    const pipeline: any[] = [
      {
        $match: { labId: labObjectId }
      },
      // Sort by submission date to get latest
      {
        $sort: { submittedAt: -1 }
      },
      // Group by student and part to find which parts they've completed
      {
        $group: {
          _id: {
            studentId: '$studentId',
            partId: '$partId'
          },
          latestSubmission: { $first: '$$ROOT' },
          hasCompletedPart: {
            $max: {
              $cond: [
                {
                  $and: [
                    { $eq: ['$status', 'completed'] },
                    { $eq: ['$gradingResult.total_points_earned', '$gradingResult.total_points_possible'] },
                    { $gt: ['$gradingResult.total_points_possible', 0] }
                  ]
                },
                1,
                0
              ]
            }
          }
        }
      },
      // Group by student to calculate progression
      {
        $group: {
          _id: '$_id.studentId',
          completedPartsCount: { $sum: '$hasCompletedPart' },
          latestSubmissionDoc: { $first: '$latestSubmission' }
        }
      },
      // Join with users to get student names
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: 'u_id',
          as: 'studentInfo'
        }
      },
      {
        $unwind: {
          path: '$studentInfo',
          preserveNullAndEmptyArrays: true
        }
      },
      // Final projection
      {
        $project: {
          _id: 0,
          studentId: '$_id',
          studentName: { $ifNull: ['$studentInfo.fullName', 'Unknown Student'] },
          // currentPart = completedParts + 1 (the part they're working on)
          // But cap it at totalParts if all parts are completed
          currentPart: {
            $cond: [
              { $eq: ['$completedPartsCount', totalParts] },
              totalParts,
              { $add: ['$completedPartsCount', 1] }
            ]
          },
          totalParts: { $literal: totalParts },
          progression: {
            $concat: [
              { $toString: '$completedPartsCount' },
              '/',
              { $toString: totalParts }
            ]
          },
          // Show grading result status (passed/failed), not submission status
          latestSubmissionStatus: {
            $cond: [
              { $eq: ['$latestSubmissionDoc.status', 'completed'] },
              {
                $cond: [
                  {
                    $and: [
                      { $eq: ['$latestSubmissionDoc.gradingResult.total_points_earned', '$latestSubmissionDoc.gradingResult.total_points_possible'] },
                      { $gt: ['$latestSubmissionDoc.gradingResult.total_points_possible', 0] }
                    ]
                  },
                  'passed',
                  'failed'
                ]
              },
              '$latestSubmissionDoc.status' // pending/running/cancelled
            ]
          },
          latestSubmissionAt: '$latestSubmissionDoc.submittedAt'
        }
      },
      // Sort by student ID
      {
        $sort: { studentId: 1 }
      }
    ];

    // Get total count before pagination
    const countPipeline = [...pipeline, { $count: 'total' }];
    const countResult = await Submission.aggregate(countPipeline);
    const total = countResult.length > 0 ? countResult[0].total : 0;

    // Add pagination
    if (options?.offset) {
      pipeline.push({ $skip: options.offset });
    }
    if (options?.limit) {
      pipeline.push({ $limit: options.limit });
    }

    const data = await Submission.aggregate(pipeline);

    return {
      data,
      total,
      limit: options?.limit || total,
      offset: options?.offset || 0
    };
  }

  /**
   * Aggregate submission activity per part for a given lab.
   * Enables UI warnings when modifying parts with existing submissions.
   */
  static async getSubmissionSummaryByPart(
    labId: string | Types.ObjectId
  ): Promise<Array<{
    partId: string;
    submissionCount: number;
    studentCount: number;
    completedCount: number;
    perfectScoreCount: number;
    lastSubmittedAt?: Date;
  }>> {
    const labObjectId = new Types.ObjectId(labId);

    const summary = await Submission.aggregate([
      {
        $match: {
          labId: labObjectId
        }
      },
      {
        $group: {
          _id: '$partId',
          submissionCount: { $sum: 1 },
          studentIds: { $addToSet: '$studentId' },
          completedCount: {
            $sum: {
              $cond: [
                { $eq: ['$status', 'completed'] },
                1,
                0
              ]
            }
          },
          perfectScoreCount: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ['$status', 'completed'] },
                    { $eq: ['$gradingResult.total_points_earned', '$gradingResult.total_points_possible'] },
                    { $gt: ['$gradingResult.total_points_possible', 0] }
                  ]
                },
                1,
                0
              ]
            }
          },
          lastSubmittedAt: { $max: '$submittedAt' }
        }
      },
      {
        $project: {
          _id: 0,
          partId: '$_id',
          submissionCount: 1,
          completedCount: 1,
          perfectScoreCount: 1,
          lastSubmittedAt: 1,
          studentCount: { $size: '$studentIds' }
        }
      },
      {
        $sort: { partId: 1 }
      }
    ]);

    return summary;
  }

  /**
   * Get submission history for a specific student in a lab, grouped by part
   */
  static async getStudentSubmissionHistory(
    labId: string | Types.ObjectId,
    studentId: string,
    options?: {
      labSessionId?: string | Types.ObjectId | null;
      groupBy?: 'part' | 'labSession';
    }
  ): Promise<any[]> {
    const matchStage: any = {
      labId: new Types.ObjectId(labId),
      studentId,
      submissionType: { $ne: 'ip_answers' }
    };

    // Fetch lab parts to get order and title information
    const partsResponse = await PartService.getPartsByLab(labId.toString());
    const partOrderMap = new Map<string, { order: number; title: string }>();
    partsResponse.parts.forEach(part => {
      partOrderMap.set(part.partId, { order: part.order, title: part.title });
    });

    if (options?.labSessionId) {
      if (options.labSessionId instanceof Types.ObjectId) {
        matchStage.labSessionId = options.labSessionId;
      } else if (Types.ObjectId.isValid(options.labSessionId)) {
        matchStage.labSessionId = new Types.ObjectId(options.labSessionId);
      } else if (options.labSessionId === 'legacy') {
        matchStage.$or = [
          { labSessionId: { $exists: false } },
          { labSessionId: null }
        ];
      }
    } else if (options && Object.prototype.hasOwnProperty.call(options, 'labSessionId') && options.labSessionId === null) {
      matchStage.$or = [
        { labSessionId: { $exists: false } },
        { labSessionId: null }
      ];
    }

    if (options?.groupBy === 'labSession') {
      const submissions = await Submission.find(matchStage)
        .sort({ submittedAt: -1 })
        .lean();

      const sessionIds = Array.from(
        new Set(
          submissions
            .map(sub => sub.labSessionId)
            .filter((id): id is Types.ObjectId => !!id)
            .map(id => id.toString())
        )
      );

      let sessionDocs: Array<any> = [];
      if (sessionIds.length > 0) {
        sessionDocs = await StudentLabSession.find({
          _id: { $in: sessionIds.map(id => new Types.ObjectId(id)) }
        })
          .lean();
      }

      const sessionMap = new Map<string, any>();
      for (const session of sessionDocs) {
        sessionMap.set(session._id.toString(), session);
      }

      interface PartHistory {
        partId: string;
        partOrder: number;
        partTitle: string;
        submissions: Array<{
          _id: any;
          attempt: number;
          status: string;
          score: number | null;
          totalPoints: number | null;
          submittedAt: Date | null;
          startedAt?: Date | null;
          completedAt?: Date | null;
          submissionType: string;
          labSessionId?: string | null;
          jobId?: string;
        }>;
      }

      interface SessionHistory {
        sessionId: string | null;
        sessionInfo: any;
        parts: Map<string, PartHistory>;
      }

      const groupedBySession = new Map<string, SessionHistory>();

      const serializeScore = (submission: any) => {
        if (submission.gradingResult) {
          return {
            score: submission.gradingResult.total_points_earned ?? null,
            totalPoints: submission.gradingResult.total_points_possible ?? null
          };
        }
        if (submission.fillInBlankResults) {
          return {
            score: submission.fillInBlankResults.totalPointsEarned ?? null,
            totalPoints: submission.fillInBlankResults.totalPoints ?? null
          };
        }
        return { score: null, totalPoints: null };
      };

      for (const submission of submissions) {
        const sessionKey = submission.labSessionId ? submission.labSessionId.toString() : 'legacy';

        if (!groupedBySession.has(sessionKey)) {
          groupedBySession.set(sessionKey, {
            sessionId: submission.labSessionId ? submission.labSessionId.toString() : null,
            sessionInfo: submission.labSessionId
              ? sessionMap.get(submission.labSessionId.toString()) ?? null
              : null,
            parts: new Map<string, PartHistory>()
          });
        }

        const sessionGroup = groupedBySession.get(sessionKey)!;
        const partId = submission.partId?.toString?.() ?? submission.partId;
        const partInfo = partOrderMap.get(partId) || { order: 999, title: partId };

        if (!sessionGroup.parts.has(partId)) {
          sessionGroup.parts.set(partId, {
            partId,
            partOrder: partInfo.order,
            partTitle: partInfo.title,
            submissions: []
          });
        }

        const { score, totalPoints } = serializeScore(submission);

        sessionGroup.parts.get(partId)!.submissions.push({
          _id: submission._id,
          attempt: submission.attempt,
          status: submission.status,
          score,
          totalPoints,
          submittedAt: submission.submittedAt ?? null,
          startedAt: submission.startedAt ?? null,
          completedAt: submission.completedAt ?? null,
          submissionType: submission.submissionType,
          labSessionId: submission.labSessionId ? submission.labSessionId.toString() : null,
          jobId: submission.jobId
        });
      }

      const orderedSessions = Array.from(groupedBySession.values())
        .map(sessionGroup => {
          const sessionInfo = sessionGroup.sessionInfo;
          const attemptNumber = sessionInfo?.attemptNumber ?? null;
          const startedAt = sessionInfo?.startedAt ?? null;

          const parts = Array.from(sessionGroup.parts.values()).map(partHistory => ({
            partId: partHistory.partId,
            partOrder: partHistory.partOrder,
            partTitle: partHistory.partTitle,
            submissions: partHistory.submissions.sort((a, b) => b.attempt - a.attempt)
          })).sort((a, b) => a.partOrder - b.partOrder);

          return {
            labSessionId: sessionGroup.sessionId,
            attemptNumber,
            session: sessionInfo ? {
              attemptNumber: sessionInfo.attemptNumber ?? null,
              status: sessionInfo.status,
              startedAt: sessionInfo.startedAt,
              completedAt: sessionInfo.completedAt ?? sessionInfo.releasedAt ?? null,
              releaseReason: sessionInfo.releaseReason ?? null,
              releasedAt: sessionInfo.releasedAt ?? null,
              instructionsAcknowledged: sessionInfo.instructionsAcknowledged ?? false,
              instructionsAcknowledgedAt: sessionInfo.instructionsAcknowledgedAt ?? null,
              managementIp: sessionInfo.managementIp ?? null
            } : null,
            parts
          };
        })
        .sort((a, b) => {
          // Sessions with known attemptNumber sorted desc, legacy sessions last
          if (a.attemptNumber !== null && b.attemptNumber !== null) {
            return b.attemptNumber - a.attemptNumber;
          }
          if (a.attemptNumber !== null) return -1;
          if (b.attemptNumber !== null) return 1;
          // Fall back to startedAt desc
          const aStarted = a.session?.startedAt ? new Date(a.session.startedAt).getTime() : 0;
          const bStarted = b.session?.startedAt ? new Date(b.session.startedAt).getTime() : 0;
          return bStarted - aStarted;
        });

      return orderedSessions;
    }

    const history = await Submission.aggregate([
      {
        $match: matchStage
      },
      {
        $project: {
          _id: 1,
          partId: 1,
          status: 1,
          attempt: 1,
          submittedAt: 1,
          completedAt: 1,
          startedAt: 1,
          score: {
            $ifNull: ['$gradingResult.total_points_earned', '$fillInBlankResults.totalPointsEarned']
          },
          totalPoints: {
            $ifNull: ['$gradingResult.total_points_possible', '$fillInBlankResults.totalPoints']
          },
          submissionType: '$submissionType'
        }
      },
      {
        $sort: { partId: 1, attempt: -1 }
      },
      {
        $group: {
          _id: '$partId',
          submissionHistory: {
            $push: {
              _id: '$_id',
              attempt: '$attempt',
              status: '$status',
              score: '$score',
              totalPoints: '$totalPoints',
              submittedAt: '$submittedAt',
              startedAt: '$startedAt',
              completedAt: '$completedAt',
              submissionType: '$submissionType'
            }
          }
        }
      },
      {
        $project: {
          _id: 0,
          partId: '$_id',
          submissionHistory: 1
        }
      },
    ]);

    // Add partOrder and partTitle, then sort by partOrder
    const enrichedHistory = history.map(item => {
      const partInfo = partOrderMap.get(item.partId) || { order: 999, title: item.partId };
      return {
        ...item,
        partOrder: partInfo.order,
        partTitle: partInfo.title
      };
    }).sort((a, b) => a.partOrder - b.partOrder);

    return enrichedHistory;
  }

  /**
   * Get detailed submission by submission ID
   * Returns complete submission with all grading results and test details
   */
  static async getSubmissionById(submissionId: string | Types.ObjectId): Promise<ISubmission | null> {
    return await Submission.findById(submissionId)
      .populate('labId', 'title description');
  }

  /**
   * Store student IP table questionnaire answers
   * Creates or updates IP answers for a specific lab part
   */
  static async storeIpAnswers(
    studentId: string,
    labId: string | Types.ObjectId,
    partId: string,
    answers: Record<string, string[][]>
  ): Promise<any> {
    const labObjectId = new Types.ObjectId(labId);

    // Find existing submission or create metadata storage
    // We use a special submission type for IP answers
    const existingSubmission = await Submission.findOne({
      studentId,
      labId: labObjectId,
      partId,
      jobId: `ip-answers-${studentId}-${labId}-${partId}` // Special jobId for IP answers
    });

    if (existingSubmission) {
      // Update existing IP answers
      existingSubmission.ipMappings = answers as any;
      existingSubmission.updatedAt = new Date();
      await existingSubmission.save();
      return existingSubmission.ipMappings;
    }

    // Create new IP answers submission
    const submission = new Submission({
      jobId: `ip-answers-${studentId}-${labId}-${partId}`,
      studentId,
      labId: labObjectId,
      partId,
      submissionType: 'ip_answers',
      ipMappings: answers as any,
      status: 'pending',
      attempt: 0 // Special attempt number for IP answers
    });

    await submission.save();
    return submission.ipMappings;
  }

  /**
   * Record a fill-in-blank submission attempt
   */
  static async recordFillInBlankSubmission(params: {
    studentId: string;
    labId: string | Types.ObjectId;
    partId: string;
    summary: IFillInBlankResults;
    answersMap?: Record<string, any>;
    labSessionId?: string | Types.ObjectId | null;
    labAttemptNumber?: number;
  }): Promise<ISubmission> {
    const labObjectId = new Types.ObjectId(params.labId);
    const jobId = `fib-${params.studentId}-${params.partId}-${Date.now()}`;
    const attempt = await this.getNextAttempt(params.studentId, labObjectId, params.partId);
    let labSessionObjectId: Types.ObjectId | undefined;

    if (params.labSessionId) {
      labSessionObjectId = params.labSessionId instanceof Types.ObjectId
        ? params.labSessionId
        : new Types.ObjectId(params.labSessionId);
    }

    const gradingResult: IGradingResult = {
      job_id: jobId,
      status: 'completed',
      total_points_earned: params.summary.totalPointsEarned,
      total_points_possible: params.summary.totalPoints,
      test_results: [],
      group_results: [],
      total_execution_time: 0,
      created_at: new Date().toISOString(),
      completed_at: new Date().toISOString()
    };

    const submission = new Submission({
      jobId,
      studentId: params.studentId,
      labId: labObjectId,
      partId: params.partId,
      submissionType: 'fill_in_blank',
      status: 'completed',
      submittedAt: new Date(),
      completedAt: new Date(),
      gradingResult,
      fillInBlankResults: params.summary,
      progressHistory: [],
      attempt,
      ipMappings: params.answersMap || {},
      labSessionId: labSessionObjectId,
      labAttemptNumber: params.labAttemptNumber
    });

    const savedSubmission = await submission.save();

    if (params.summary.passed && params.summary.totalPoints > 0) {
      try {
        const allPartsCompleted = await this.areAllPartsCompleted(
          params.studentId,
          labObjectId,
          { labSessionId: labSessionObjectId }
        );

        if (allPartsCompleted) {
          await StudentLabSessionService.deleteSession(
            params.studentId,
            labObjectId,
            {
              reason: 'completion',
              completedAt: savedSubmission.completedAt ?? new Date()
            }
          );
          console.log(`[Session Released] Student ${params.studentId} completed ALL parts of lab ${labObjectId} - IP released`);
        }
      } catch (error) {
        console.error('Error checking/releasing student lab session for fill-in-blank submission:', error);
      }
    }

    return savedSubmission;
  }

  /**
   * Retrieve student IP table questionnaire answers
   * Gets IP answers for a specific lab part
   */
  static async getIpAnswers(
    studentId: string,
    labId: string | Types.ObjectId,
    partId: string
  ): Promise<Record<string, string[][]> | null> {
    const labObjectId = new Types.ObjectId(labId);

    const submission = await Submission.findOne({
      studentId,
      labId: labObjectId,
      partId,
      jobId: `ip-answers-${studentId}-${labId}-${partId}`
    });

    if (!submission) {
      return null;
    }

    return submission.ipMappings as any;
  }

  /**
   * Get all submission history for a user across all courses/labs
   * Returns submissions sorted by date descending with lab and course info
   */
  static async getAllUserSubmissionHistory(
    studentId: string,
    options?: {
      limit?: number;
      offset?: number;
    }
  ): Promise<{ data: any[]; total: number; limit: number; offset: number }> {
    const matchStage: any = {
      studentId,
      submissionType: { $ne: 'ip_answers' } // Exclude IP answer saves
    };

    // Count total before pagination
    const total = await Submission.countDocuments(matchStage);

    const submissions = await Submission.aggregate([
      {
        $match: matchStage
      },
      {
        $sort: { submittedAt: -1 }
      },
      {
        $skip: options?.offset || 0
      },
      {
        $limit: options?.limit || 20
      },
      // Join with labs collection
      {
        $lookup: {
          from: 'labs',
          localField: 'labId',
          foreignField: '_id',
          as: 'labInfo'
        }
      },
      {
        $unwind: {
          path: '$labInfo',
          preserveNullAndEmptyArrays: true
        }
      },
      // Join with courses collection
      {
        $lookup: {
          from: 'courses',
          localField: 'labInfo.courseId',
          foreignField: '_id',
          as: 'courseInfo'
        }
      },
      {
        $unwind: {
          path: '$courseInfo',
          preserveNullAndEmptyArrays: true
        }
      },
      // Join with lab_parts collection to get part info
      {
        $lookup: {
          from: 'lab_parts',
          let: { labId: '$labId', partId: '$partId' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ['$lab_id', '$$labId'] },
                    { $eq: ['$partId', '$$partId'] }
                  ]
                }
              }
            }
          ],
          as: 'partInfo'
        }
      },
      {
        $unwind: {
          path: '$partInfo',
          preserveNullAndEmptyArrays: true
        }
      },
      {
        $project: {
          _id: 1,
          jobId: 1,
          partId: 1,
          partTitle: { $ifNull: ['$partInfo.title', '$partId'] },
          partOrder: { $ifNull: ['$partInfo.order', 0] },
          status: 1,
          attempt: 1,
          submittedAt: 1,
          completedAt: 1,
          submissionType: 1,
          score: {
            $ifNull: ['$gradingResult.total_points_earned', '$fillInBlankResults.totalPointsEarned', null]
          },
          totalPoints: {
            $ifNull: ['$gradingResult.total_points_possible', '$fillInBlankResults.totalPoints', null]
          },
          lab: {
            _id: '$labInfo._id',
            title: { $ifNull: ['$labInfo.title', 'Unknown Lab'] }
          },
          course: {
            _id: '$courseInfo._id',
            title: { $ifNull: ['$courseInfo.title', 'Unknown Course'] },
            code: ''
          }
        }
      }
    ]);

    return {
      data: submissions,
      total,
      limit: options?.limit || 20,
      offset: options?.offset || 0
    };
  }
}

