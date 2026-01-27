import { Types } from 'mongoose';
import { Submission } from './model';
import { SubmissionService } from './service';
import { PartService } from '../parts/service';
import { Lab } from '../labs/model';
import { Enrollment } from '../enrollments/model';
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
     * @param labId - The lab to export scores for
     * @param asOfDate - The point in time to calculate scores from
     * @returns Array of student scores with adjusted late penalties
     */
    static async exportLabScoresAtTime(
        labId: string,
        asOfDate: Date
    ): Promise<LabScoreExportRow[]> {
        // 1. Get the lab to find course ID and deadline info
        const lab = await Lab.findById(new Types.ObjectId(labId))
            .select('courseId dueDate availableUntil')
            .lean();

        if (!lab) {
            throw new Error(`Lab not found: ${labId}`);
        }

        const labDueDate = lab.dueDate ?? null;
        const labAvailableUntil = lab.availableUntil ?? null;

        // 2. Get all parts for this lab to calculate total possible points
        const partsResponse = await PartService.getPartsByLab(labId);
        const parts = partsResponse.parts.filter(p => !p.isVirtual && !p.isPartZero);

        // Map partId -> totalPoints
        const partPointsMap = new Map<string, number>();
        let totalPossiblePoints = 0;

        for (const part of parts) {
            const partPoints = part.totalPoints ?? 0;
            partPointsMap.set(part.partId, partPoints);
            totalPossiblePoints += partPoints;
        }

        // 3. Get all students enrolled in the course (as students, not instructors/TAs)
        const enrollments = await Enrollment.find({
            c_id: lab.courseId,
            u_role: 'STUDENT'
        }).lean();

        const studentIds = enrollments.map(e => e.u_id);

        // 4. Get user details for all students
        const users = await User.find({
            u_id: { $in: studentIds }
        }).select('u_id fullName').lean();

        const userMap = new Map<string, { fullName?: string }>();
        for (const user of users) {
            userMap.set(user.u_id, { fullName: user.fullName });
        }

        // 5. Get all submissions for this lab before asOfDate
        const submissions = await Submission.find({
            labId: new Types.ObjectId(labId),
            studentId: { $in: studentIds },
            submissionType: { $ne: 'ip_answers' },
            status: 'completed',
            createdAt: { $lte: asOfDate }
        }).select('studentId partId score totalPoints submittedAt gradingResult fillInBlankResults').lean();

        // 6. Group submissions by student, then by part, and find best score per part
        const studentScores = new Map<string, {
            totalScore: number;
            hasLateSubmission: boolean;
            partScores: Map<string, number>;
        }>();

        // Initialize all students with zero scores
        for (const studentId of studentIds) {
            studentScores.set(studentId, {
                totalScore: 0,
                hasLateSubmission: false,
                partScores: new Map()
            });
        }

        // Process each submission
        for (const sub of submissions) {
            const studentId = sub.studentId;
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
