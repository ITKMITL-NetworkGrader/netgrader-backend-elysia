import { Types } from 'mongoose';
import { Submission } from './model';
import { SubmissionService } from './service';
import { PartService } from '../parts/service';
import { Lab } from '../labs/model';
import { User } from '../auth/model';

export interface LabScoreExportRow {
    studentId: string;
    studentName: string;
    currentScore: number;
    fullLabScore: number;
    isLate: boolean;
}

interface PartScoreData {
    bestScoreBeforeDue: number;
    bestOverallRawScore: number;
}

interface StudentScoreData {
    hasLateSubmission: boolean;
    partScores: Map<string, PartScoreData>;
}

/** Late penalty multiplier for improvements after due date (50% = 0.5) */
const LATE_PENALTY_MULTIPLIER = 0.5;

export class ExportService {
    /**
     * Export lab scores for all students as of a specific date/time.
     * Uses incremental penalty formula: only improvements made after due date
     * are penalized, not the entire score.
     * 
     * Formula: finalScore = (bestOverall - bestBeforeDue) * 50% + bestBeforeDue
     * 
     * @param labId - The lab to export scores for
     * @param asOfDate - The point in time to calculate scores from
     * @returns Array of student scores with adjusted late penalties
     */
    static async exportLabScoresAtTime(
        labId: string,
        asOfDate: Date
    ): Promise<LabScoreExportRow[]> {
        const labObjectId = new Types.ObjectId(labId);

        // Fetch lab, parts, and submissions in parallel where possible
        const [lab, partsResponse, submissions] = await Promise.all([
            Lab.findById(labObjectId).select('dueDate availableUntil').lean(),
            PartService.getPartsByLab(labId),
            Submission.find({
                labId: labObjectId,
                submissionType: { $ne: 'ip_answers' },
                status: 'completed',
                createdAt: { $lte: asOfDate }
            }).select('studentId partId gradingResult fillInBlankResults createdAt').lean()
        ]);

        if (!lab) {
            throw new Error(`Lab not found: ${labId}`);
        }

        // Early return if no submissions
        if (submissions.length === 0) {
            return [];
        }

        const labDueDate = lab.dueDate ?? null;
        const labAvailableUntil = lab.availableUntil ?? null;

        // Calculate total possible points from non-virtual parts
        const totalPossiblePoints = partsResponse.parts
            .filter(p => !p.isVirtual && !p.isPartZero)
            .reduce((sum, part) => sum + (part.totalPoints ?? 0), 0);

        // Build student scores map
        const studentScores = this.buildStudentScoresMap(
            submissions,
            labDueDate,
            labAvailableUntil
        );

        // Get unique student IDs and fetch user details
        const studentIds = Array.from(studentScores.keys());
        const userMap = await this.fetchUserMap(studentIds);

        // Calculate and build results
        const results = this.calculateFinalScores(
            studentIds,
            studentScores,
            userMap,
            totalPossiblePoints
        );

        // Sort by student ID for consistent output
        results.sort((a, b) => a.studentId.localeCompare(b.studentId));

        return results;
    }

    /**
     * Process submissions and build a map of student scores.
     * Tracks best scores before and after due date for each part.
     */
    private static buildStudentScoresMap(
        submissions: any[],
        labDueDate: Date | null,
        labAvailableUntil: Date | null | undefined
    ): Map<string, StudentScoreData> {
        const studentScores = new Map<string, StudentScoreData>();

        for (const sub of submissions) {
            const studentId = sub.studentId.toLowerCase();
            const partId = sub.partId;

            // Extract score from submission
            const rawScore = this.extractRawScore(sub);

            // Check if this submission is late
            const { isLate } = SubmissionService.calculateLatePenalty(
                sub.createdAt ?? null,
                labDueDate,
                labAvailableUntil
            );

            // Initialize student data if not exists
            if (!studentScores.has(studentId)) {
                studentScores.set(studentId, {
                    hasLateSubmission: false,
                    partScores: new Map()
                });
            }

            const studentData = studentScores.get(studentId)!;

            // Track late submission flag
            if (isLate) {
                studentData.hasLateSubmission = true;
            }

            // Initialize part data if not exists
            if (!studentData.partScores.has(partId)) {
                studentData.partScores.set(partId, {
                    bestScoreBeforeDue: 0,
                    bestOverallRawScore: 0
                });
            }

            const partData = studentData.partScores.get(partId)!;

            // Update best overall raw score
            if (rawScore > partData.bestOverallRawScore) {
                partData.bestOverallRawScore = rawScore;
            }

            // Update best score before due date (only if on time)
            if (!isLate && rawScore > partData.bestScoreBeforeDue) {
                partData.bestScoreBeforeDue = rawScore;
            }
        }

        return studentScores;
    }

    /**
     * Extract raw score from a submission (grading result or fill-in-blank).
     */
    private static extractRawScore(sub: any): number {
        if (sub.gradingResult?.total_points_earned !== undefined) {
            return sub.gradingResult.total_points_earned;
        }
        if (sub.fillInBlankResults?.totalPointsEarned !== undefined) {
            return sub.fillInBlankResults.totalPointsEarned;
        }
        return 0;
    }

    /**
     * Fetch user details and build a lookup map.
     */
    private static async fetchUserMap(
        studentIds: string[]
    ): Promise<Map<string, string>> {
        const users = await User.find({
            u_id: { $in: studentIds }
        }).select('u_id fullName').lean();

        const userMap = new Map<string, string>();
        for (const user of users) {
            userMap.set(user.u_id.toLowerCase(), user.fullName ?? user.u_id);
        }
        return userMap;
    }

    /**
     * Calculate final adjusted scores using incremental penalty formula.
     * Penalty only applies to score improvements made after due date.
     */
    private static calculateFinalScores(
        studentIds: string[],
        studentScores: Map<string, StudentScoreData>,
        userMap: Map<string, string>,
        totalPossiblePoints: number
    ): LabScoreExportRow[] {
        const results: LabScoreExportRow[] = [];

        for (const studentId of studentIds) {
            const studentData = studentScores.get(studentId)!;
            let totalScore = 0;

            // Calculate adjusted score for each part and sum
            for (const partData of studentData.partScores.values()) {
                totalScore += this.calculateAdjustedPartScore(partData);
            }

            results.push({
                studentId,
                studentName: userMap.get(studentId) ?? studentId,
                currentScore: Math.round(totalScore * 100) / 100,
                fullLabScore: totalPossiblePoints,
                isLate: studentData.hasLateSubmission
            });
        }

        return results;
    }

    /**
     * Calculate adjusted score for a single part.
     * Formula: (bestOverall - bestBeforeDue) * penaltyMultiplier + bestBeforeDue
     */
    private static calculateAdjustedPartScore(partData: PartScoreData): number {
        const { bestScoreBeforeDue, bestOverallRawScore } = partData;

        // No late improvement - use pre-deadline score
        if (bestOverallRawScore <= bestScoreBeforeDue) {
            return bestScoreBeforeDue;
        }

        // Apply penalty only to the late improvement portion
        const lateImprovement = bestOverallRawScore - bestScoreBeforeDue;
        return lateImprovement * LATE_PENALTY_MULTIPLIER + bestScoreBeforeDue;
    }
}
