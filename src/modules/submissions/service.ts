import { Types } from 'mongoose';
import { Submission, ISubmission, IGradingResult, IProgressUpdate } from './model';
import { StudentLabSessionService } from '../student-lab-sessions/service';
import { PartService } from '../parts/service';

export class SubmissionService {
  
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
  }): Promise<ISubmission> {
    const labObjectId = new Types.ObjectId(data.labId);
    
    // Find the highest attempt number for this student/lab/part combination
    const latestSubmission = await Submission.findOne({
      studentId: data.studentId,
      labId: labObjectId,
      partId: data.partId
    }).sort({ attempt: -1 });

    const nextAttempt = latestSubmission ? latestSubmission.attempt + 1 : 1;

    const submission = new Submission({
      jobId: data.jobId,
      studentId: data.studentId,
      labId: labObjectId,
      partId: data.partId,
      ipMappings: data.ipMappings,
      attempt: nextAttempt,
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
            submission.labId as Types.ObjectId
          );

          if (allPartsCompleted) {
            // Delete session to release IP
            await StudentLabSessionService.deleteSession(
              submission.studentId,
              submission.labId as Types.ObjectId
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
    labId: Types.ObjectId
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

      for (const partId of partIds) {
        const perfectSubmission = await Submission.findOne({
          studentId,
          labId,
          partId,
          status: 'completed',
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

      console.log(`[Parts Check] Student ${studentId} - Lab ${labId}: ${completedPartIds.size}/${totalParts} parts completed`);

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
    }
  ): Promise<ISubmission[]> {
    const query: any = { studentId };
    
    if (options?.labId) {
      query.labId = new Types.ObjectId(options.labId);
    }
    
    if (options?.status) {
      query.status = options.status;
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
  ): Promise<ISubmission[]> {
    const query: any = { labId: new Types.ObjectId(labId) };
    
    if (options?.status) {
      query.status = options.status;
    }

    return await Submission.find(query)
      .populate('studentId', 'name email')
      .sort({ submittedAt: -1 })
      .limit(options?.limit || 100)
      .skip(options?.offset || 0);
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
}