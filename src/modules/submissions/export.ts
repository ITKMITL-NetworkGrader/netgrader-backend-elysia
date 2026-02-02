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

/** Lab deadline and penalty configuration */
interface LabConfig {
    dueDate: Date | null;
    availableUntil: Date | null | undefined;
    latePenaltyPercent: number;
}

export class ExportService {
    /**
     * Export lab scores for all students.
     */
    static async exportLabScoresAtTime(
        labId: string,
        asOfDate: Date
    ): Promise<LabScoreExportRow[]> {
        const labObjectId = new Types.ObjectId(labId);

        // Fetch lab, parts, and submissions in parallel
        const [lab, partsResponse, submissions] = await Promise.all([
            Lab.findById(labObjectId).select('dueDate availableUntil latePenaltyPercent').lean(),
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

        if (submissions.length === 0) {
            return [];
        }

        const labConfig: LabConfig = {
            dueDate: lab.dueDate ?? null,
            availableUntil: lab.availableUntil ?? null,
            latePenaltyPercent: lab.latePenaltyPercent ?? 50
        };

        const totalPossiblePoints = partsResponse.parts
            .filter(p => !p.isVirtual && !p.isPartZero)
            .reduce((sum, part) => sum + (part.totalPoints ?? 0), 0);

        const studentScores = this.buildStudentScoresMap(submissions, labConfig);
        const studentIds = Array.from(studentScores.keys());
        const userMap = await this.fetchUserMap(studentIds);

        const results = this.calculateFinalScores(
            studentScores,
            userMap,
            totalPossiblePoints,
            labConfig.latePenaltyPercent
        );

        results.sort((a, b) => a.studentId.localeCompare(b.studentId));
        return results;
    }

    /**
     * Process submissions and build a map of student scores.
     */
    private static buildStudentScoresMap(
        submissions: any[],
        labConfig: LabConfig
    ): Map<string, StudentScoreData> {
        const studentScores = new Map<string, StudentScoreData>();

        for (const sub of submissions) {
            const studentId = sub.studentId.toLowerCase();
            const partId = sub.partId;
            const rawScore = this.extractRawScore(sub);

            const { isLate } = SubmissionService.calculateLatePenalty(
                sub.createdAt ?? null,
                labConfig.dueDate,
                labConfig.availableUntil,
                labConfig.latePenaltyPercent
            );

            // Get or create student data
            let studentData = studentScores.get(studentId);
            if (!studentData) {
                studentData = { hasLateSubmission: false, partScores: new Map() };
                studentScores.set(studentId, studentData);
            }

            if (isLate) {
                studentData.hasLateSubmission = true;
            }

            // Get or create part data
            let partData = studentData.partScores.get(partId);
            if (!partData) {
                partData = { bestScoreBeforeDue: 0, bestOverallRawScore: 0 };
                studentData.partScores.set(partId, partData);
            }

            // Update best scores
            if (rawScore > partData.bestOverallRawScore) {
                partData.bestOverallRawScore = rawScore;
            }
            if (!isLate && rawScore > partData.bestScoreBeforeDue) {
                partData.bestScoreBeforeDue = rawScore;
            }
        }

        return studentScores;
    }

    private static extractRawScore(sub: any): number {
        return sub.gradingResult?.total_points_earned
            ?? sub.fillInBlankResults?.totalPointsEarned
            ?? 0;
    }

    private static async fetchUserMap(studentIds: string[]): Promise<Map<string, string>> {
        const users = await User.find({ u_id: { $in: studentIds } })
            .select('u_id fullName')
            .lean();

        return new Map(users.map(u => [u.u_id.toLowerCase(), u.fullName ?? u.u_id]));
    }

    /**
     * Calculate final adjusted scores using incremental penalty formula.
     */
    private static calculateFinalScores(
        studentScores: Map<string, StudentScoreData>,
        userMap: Map<string, string>,
        totalPossiblePoints: number,
        latePenaltyPercent: number
    ): LabScoreExportRow[] {
        const penaltyMultiplier = (100 - latePenaltyPercent) / 100;

        return Array.from(studentScores.entries()).map(([studentId, data]) => {
            const totalScore = Array.from(data.partScores.values())
                .reduce((sum, part) => sum + this.calculateAdjustedPartScore(part, penaltyMultiplier), 0);

            return {
                studentId,
                studentName: userMap.get(studentId) ?? studentId,
                currentScore: Math.round(totalScore * 100) / 100,
                fullLabScore: totalPossiblePoints,
                isLate: data.hasLateSubmission
            };
        });
    }

    /**
     * Apply penalty only to the late improvement portion.
     */
    private static calculateAdjustedPartScore(partData: PartScoreData, penaltyMultiplier: number): number {
        const { bestScoreBeforeDue, bestOverallRawScore } = partData;

        if (bestOverallRawScore <= bestScoreBeforeDue) {
            return bestScoreBeforeDue;
        }

        const lateImprovement = bestOverallRawScore - bestScoreBeforeDue;
        return lateImprovement * penaltyMultiplier + bestScoreBeforeDue;
    }
}
