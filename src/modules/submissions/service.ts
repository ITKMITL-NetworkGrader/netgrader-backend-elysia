import { Types } from 'mongoose';
import { Submission, ISubmission, IGradingResult, IProgressUpdate } from './model';

export class SubmissionService {
  
  /**
   * Create a new submission record or increment attempt for existing student/lab/part
   */
  static async createSubmission(data: {
    jobId: string;
    studentId: string | Types.ObjectId;
    labId: string | Types.ObjectId;
    partId: string;
    ipMappings: Record<string, string>;
    callbackUrl: string;
    attempt?: number;
  }): Promise<ISubmission> {
    const studentObjectId = new Types.ObjectId(data.studentId);
    const labObjectId = new Types.ObjectId(data.labId);
    
    // Find the highest attempt number for this student/lab/part combination
    const latestSubmission = await Submission.findOne({
      studentId: studentObjectId,
      labId: labObjectId,
      partId: data.partId
    }).sort({ attempt: -1 });

    const nextAttempt = latestSubmission ? latestSubmission.attempt + 1 : 1;

    const submission = new Submission({
      jobId: data.jobId,
      studentId: studentObjectId,
      labId: labObjectId,
      partId: data.partId,
      ipMappings: data.ipMappings,
      callbackUrl: data.callbackUrl,
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

    return await Submission.findOneAndUpdate(
      { jobId },
      updateData,
      { new: true }
    );
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
    studentId: string | Types.ObjectId,
    options?: {
      labId?: string | Types.ObjectId;
      status?: string;
      limit?: number;
      offset?: number;
    }
  ): Promise<ISubmission[]> {
    const query: any = { studentId: new Types.ObjectId(studentId) };
    
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
    studentId: string | Types.ObjectId,
    labId: string | Types.ObjectId,
    partId: string
  ): Promise<ISubmission | null> {
    return await Submission.findOne({
      studentId: new Types.ObjectId(studentId),
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