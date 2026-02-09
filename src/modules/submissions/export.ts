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
    isCompleted: boolean;
    partsCompleted: number;
    totalParts: number;
}

interface PartScoreData {
    bestScoreBeforeDue: number;
    bestOverallRawScore: number;
    maxPossiblePoints: number;
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

        // Get total parts count (non-virtual, non-part-zero)
        const validParts = partsResponse.parts.filter(p => !p.isVirtual && !p.isPartZero);
        const totalParts = validParts.length;
        const totalPossiblePoints = validParts.reduce((sum, part) => sum + (part.totalPoints ?? 0), 0);

        // Create a map from part slug to current totalPoints
        const partMaxPoints = new Map<string, number>();
        for (const part of validParts) {
            // Slugify title to match submission partId format (lowercase, hyphenated)
            const slug = part.title?.toLowerCase().replace(/\s+/g, '-') ?? '';
            partMaxPoints.set(slug, part.totalPoints ?? 0);
        }

        const studentScores = this.buildStudentScoresMap(submissions, labConfig);
        const studentIds = Array.from(studentScores.keys());
        const userMap = await this.fetchUserMap(studentIds);

        const results = this.calculateFinalScores(
            studentScores,
            userMap,
            totalPossiblePoints,
            totalParts,
            labConfig.latePenaltyPercent,
            partMaxPoints
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
                partData = { bestScoreBeforeDue: 0, bestOverallRawScore: 0, maxPossiblePoints: 0 };
                studentData.partScores.set(partId, partData);
            }

            // Update max possible points
            const maxPoints = this.extractMaxPoints(sub);
            if (maxPoints > partData.maxPossiblePoints) {
                partData.maxPossiblePoints = maxPoints;
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

    private static extractMaxPoints(sub: any): number {
        return sub.gradingResult?.total_points_possible
            ?? sub.fillInBlankResults?.totalPoints
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
        totalParts: number,
        latePenaltyPercent: number,
        partMaxPoints: Map<string, number>
    ): LabScoreExportRow[] {
        const penaltyMultiplier = (100 - latePenaltyPercent) / 100;

        return Array.from(studentScores.entries()).map(([studentId, data]) => {
            let totalScore = 0;
            let partsCompleted = 0;

            for (const [partId, partData] of data.partScores.entries()) {
                const adjustedScore = this.calculateAdjustedPartScore(partData, penaltyMultiplier);
                totalScore += adjustedScore;

                // Use current part definition's totalPoints, not stale submission data
                const currentMaxPoints = partMaxPoints.get(partId) ?? partData.maxPossiblePoints;

                // A part is completed if student got full raw marks (with floating point tolerance)
                const EPSILON = 0.001;
                if (currentMaxPoints > 0 && partData.bestOverallRawScore >= currentMaxPoints - EPSILON) {
                    partsCompleted++;
                }
            }

            const roundedScore = Math.round(totalScore * 100) / 100;
            const isCompleted = partsCompleted === totalParts && totalParts > 0;

            return {
                studentId,
                studentName: userMap.get(studentId) ?? studentId,
                currentScore: roundedScore,
                fullLabScore: totalPossiblePoints,
                isLate: data.hasLateSubmission,
                isCompleted,
                partsCompleted,
                totalParts
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
