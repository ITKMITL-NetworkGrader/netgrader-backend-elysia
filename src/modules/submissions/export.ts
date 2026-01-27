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

export class ExportService {
    /**
     * Export lab scores for all students as of a specific date/time
     * This is the "time machine" feature - shows what scores would have been at that point
     * 
     * Finds students based on who has submitted to this lab (matching Status tab behavior),
     * NOT based on enrollment records.
     * 
     * @param labId - The lab to export scores for
     * @param asOfDate - The point in time to calculate scores from
     * @returns Array of student scores with adjusted late penalties
     */
    static async exportLabScoresAtTime(
        labId: string,
        asOfDate: Date
    ): Promise<LabScoreExportRow[]> {
        // 1. Get the lab to find deadline info
        const lab = await Lab.findById(new Types.ObjectId(labId))
            .select('dueDate availableUntil')
            .lean();

        if (!lab) {
            throw new Error(`Lab not found: ${labId}`);
        }

        const labDueDate = lab.dueDate ?? null;
        const labAvailableUntil = lab.availableUntil ?? null;

        // 2. Get all parts for this lab to calculate total possible points
        const partsResponse = await PartService.getPartsByLab(labId);
        const parts = partsResponse.parts.filter(p => !p.isVirtual && !p.isPartZero);

        let totalPossiblePoints = 0;
        for (const part of parts) {
            totalPossiblePoints += part.totalPoints ?? 0;
        }

        // 3. Get all submissions for this lab before asOfDate
        // This finds students based on who has actually submitted (like Status tab does)
        const submissions = await Submission.find({
            labId: new Types.ObjectId(labId),
            submissionType: { $ne: 'ip_answers' },
            status: 'completed',
            createdAt: { $lte: asOfDate }
        }).select('studentId partId gradingResult fillInBlankResults createdAt').lean();

        console.log(`[Export] Found ${submissions.length} submissions before ${asOfDate.toISOString()}`);

        // 4. Get unique student IDs from submissions
        const studentIdsSet = new Set<string>();
        for (const sub of submissions) {
            studentIdsSet.add(sub.studentId.toLowerCase());
        }
        const studentIds = Array.from(studentIdsSet);

        console.log(`[Export] Found ${studentIds.length} unique students with submissions`);

        // 5. Get user details for all students
        const users = await User.find({
            u_id: { $in: studentIds }
        }).select('u_id fullName').lean();

        const userMap = new Map<string, { fullName?: string }>();
        for (const user of users) {
            userMap.set(user.u_id.toLowerCase(), { fullName: user.fullName });
        }

        // 6. Group submissions by student, then by part, and find best score per part
        const studentScores = new Map<string, {
            hasLateSubmission: boolean;
            partScores: Map<string, number>;
        }>();

        // Initialize all students with empty scores
        for (const studentId of studentIds) {
            studentScores.set(studentId, {
                hasLateSubmission: false,
                partScores: new Map()
            });
        }

        // Process each submission
        for (const sub of submissions) {
            const studentId = sub.studentId.toLowerCase();
            const partId = sub.partId;

            // Get raw score from submission
            let rawScore = 0;
            if (sub.gradingResult?.total_points_earned !== undefined) {
                rawScore = sub.gradingResult.total_points_earned;
            } else if (sub.fillInBlankResults?.totalPointsEarned !== undefined) {
                rawScore = sub.fillInBlankResults.totalPointsEarned;
            }

            // Calculate late penalty
            const penalty = SubmissionService.calculateLatePenalty(
                sub.createdAt ?? null,
                labDueDate,
                labAvailableUntil
            );

            const adjustedScore = SubmissionService.applyLatePenalty(rawScore, penalty.penaltyMultiplier);

            // Get student's current scores
            const studentData = studentScores.get(studentId);
            if (!studentData) continue;

            // Track if student has any late submissions
            if (penalty.isLate) {
                studentData.hasLateSubmission = true;
            }

            // Keep best score per part
            const currentPartScore = studentData.partScores.get(partId) ?? 0;
            if (adjustedScore > currentPartScore) {
                studentData.partScores.set(partId, adjustedScore);
            }
        }

        // 7. Calculate total score for each student
        const results: LabScoreExportRow[] = [];

        for (const studentId of studentIds) {
            const studentData = studentScores.get(studentId)!;
            const user = userMap.get(studentId);

            // Sum up best scores from all parts
            let totalScore = 0;
            for (const partScore of studentData.partScores.values()) {
                totalScore += partScore;
            }

            results.push({
                studentId,
                studentName: user?.fullName || studentId,
                currentScore: totalScore,
                fullLabScore: totalPossiblePoints,
                isLate: studentData.hasLateSubmission
            });
        }

        // Sort by student ID for consistent output
        results.sort((a, b) => a.studentId.localeCompare(b.studentId));

        return results;
    }
}
