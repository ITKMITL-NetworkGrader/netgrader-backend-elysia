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
  );
