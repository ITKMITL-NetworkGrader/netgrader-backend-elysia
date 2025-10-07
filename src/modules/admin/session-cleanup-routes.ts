import { Elysia, t } from "elysia";
import { authPlugin, requireRole } from "../../plugins/plugins";
import { LabSessionCleanupService } from "../../services/lab-session-cleanup";

/**
 * Admin routes for managing lab session cleanup
 */
export const sessionCleanupRoutes = new Elysia({ prefix: "/admin/sessions" })
  .use(authPlugin)
  .get(
    "/cleanup/expired",
    async ({ set }) => {
      try {
        const result = await LabSessionCleanupService.cleanupExpiredLabSessions();
        return {
          status: "success",
          released: result.released,
          details: result.details,
          message: `Released ${result.released} IPs from expired labs`
        };
      } catch (error) {
        console.error("Error during manual cleanup:", error);
        set.status = 500;
        return {
          status: "error",
          message: `Cleanup failed: ${(error as Error).message}`
        };
      }
    },
    {
      beforeHandle: requireRole(["ADMIN"]),
      detail: {
        tags: ["Admin"],
        summary: "Manually trigger cleanup of expired lab sessions",
        description: "Releases IPs for labs that have reached their timeout (availableUntil or dueDate)"
      }
    }
  )
  .get(
    "/cleanup/old",
    async ({ query, set }) => {
      try {
        const days = parseInt(query.days || "90");
        const result = await LabSessionCleanupService.cleanupOldCompletedSessions(days);
        return {
          status: "success",
          deleted: result.deleted,
          message: result.message
        };
      } catch (error) {
        console.error("Error during old sessions cleanup:", error);
        set.status = 500;
        return {
          status: "error",
          message: `Cleanup failed: ${(error as Error).message}`
        };
      }
    },
    {
      beforeHandle: requireRole(["ADMIN"]),
      query: t.Object({
        days: t.Optional(t.String())
      }),
      detail: {
        tags: ["Admin"],
        summary: "Cleanup old completed sessions",
        description: "Delete completed sessions older than specified days (default: 90)"
      }
    }
  )
  .get(
    "/stats",
    async ({ set }) => {
      try {
        const stats = await LabSessionCleanupService.getSessionStats();
        return {
          status: "success",
          data: stats
        };
      } catch (error) {
        console.error("Error fetching session stats:", error);
        set.status = 500;
        return {
          status: "error",
          message: `Failed to fetch stats: ${(error as Error).message}`
        };
      }
    },
    {
      beforeHandle: requireRole(["ADMIN"]),
      detail: {
        tags: ["Admin"],
        summary: "Get session statistics",
        description: "Get current statistics about active, completed, and expiring sessions"
      }
    }
  )
  .get(
    "/student/:studentId/lab/:labId",
    async ({ params, set }) => {
      try {
        const { StudentLabSession } = await import("../student-lab-sessions/model");
        const { Submission } = await import("../submissions/model");
        const { PartService } = await import("../parts/service");
        const { Types } = await import("mongoose");

        const labObjectId = new Types.ObjectId(params.labId);

        // Get session
        const session = await StudentLabSession.findOne({
          studentId: params.studentId,
          labId: labObjectId,
          status: "active"
        });

        if (!session) {
          return {
            status: "success",
            data: {
              hasActiveSession: false,
              message: "No active session found for this student-lab combination"
            }
          };
        }

        // Get all parts for this lab
        const partsResponse = await PartService.getPartsByLab(params.labId);
        const totalParts = partsResponse.parts.length;
        const partIds = partsResponse.parts.map(p => p.partId);

        // Check completion status for each part
        const partCompletionStatus = [];
        let completedParts = 0;

        for (const partId of partIds) {
          const submissions = await Submission.find({
            studentId: params.studentId,
            labId: labObjectId,
            partId,
            status: "completed"
          }).sort({ attempt: -1 });

          const perfectSubmission = submissions.find(s =>
            s.gradingResult &&
            s.gradingResult.total_points_earned === s.gradingResult.total_points_possible &&
            s.gradingResult.total_points_possible > 0
          );

          const hasCompleted = !!perfectSubmission;
          if (hasCompleted) completedParts++;

          partCompletionStatus.push({
            partId,
            completed: hasCompleted,
            bestScore: perfectSubmission
              ? `${perfectSubmission.gradingResult?.total_points_earned}/${perfectSubmission.gradingResult?.total_points_possible}`
              : submissions.length > 0
                ? `${submissions[0].gradingResult?.total_points_earned}/${submissions[0].gradingResult?.total_points_possible}`
                : "No submissions",
            attempts: submissions.length
          });
        }

        return {
          status: "success",
          data: {
            hasActiveSession: true,
            session: {
              sessionId: session._id,
              managementIp: session.managementIp,
              studentIndex: session.studentIndex,
              status: session.status,
              startedAt: session.startedAt,
              lastAccessedAt: session.lastAccessedAt
            },
            progress: {
              totalParts,
              completedParts,
              percentComplete: Math.round((completedParts / totalParts) * 100),
              willReleaseIp: completedParts === totalParts,
              parts: partCompletionStatus
            }
          }
        };
      } catch (error) {
        console.error("Error fetching student session:", error);
        set.status = 500;
        return {
          status: "error",
          message: `Failed to fetch session: ${(error as Error).message}`
        };
      }
    },
    {
      beforeHandle: requireRole(["ADMIN", "INSTRUCTOR"]),
      params: t.Object({
        studentId: t.String(),
        labId: t.String()
      }),
      detail: {
        tags: ["Admin"],
        summary: "Get student session details for a specific lab",
        description: "Shows session status, IP assignment, and part completion progress. Useful for debugging IP release logic."
      }
    }
  );
