import { Elysia, t } from "elysia";
import { authPlugin, requireRole } from "../../plugins/plugins";
import { AuthService } from "../auth/service";
import { User } from "../auth/model";
import crypto from "crypto";

/**
 * Admin routes for syncing users to GNS3
 */
export const gns3SyncRoutes = new Elysia({ prefix: "/admin/gns3-sync" })
    .use(authPlugin)

    // Sync a single user to GNS3
    .post(
        "/user/:userId",
        async ({ params, set }) => {
            try {
                // Find user by u_id (student ID)
                const user = await User.findOne({ u_id: params.userId.toLowerCase() });

                if (!user) {
                    set.status = 404;
                    return {
                        status: "error",
                        message: `User "${params.userId}" not found`
                    };
                }

                // Note: We cannot retrieve the original password from MongoDB (it's hashed)
                // So we'll generate a temporary password that the admin should communicate to the student
                // Or the student can reset it later
                const tempPassword = generateTempPassword();

                const result = await AuthService.createGNS3UserAndPool(
                    user.u_id,
                    user.fullName || user.u_id,
                    tempPassword
                );

                if (result.success) {
                    // DEEP2-7: Do not include tempPassword in response
                    return {
                        status: "success",
                        message: `GNS3 user and pool created for ${user.u_id}`,
                        data: {
                            userId: result.userId,
                            poolId: result.poolId,
                            gns3Username: `it${user.u_id}`,
                            gns3PoolName: `it${user.u_id}-pool`,
                        }
                    };
                } else {
                    set.status = 500;
                    return {
                        status: "error",
                        message: result.error || "Failed to create GNS3 user/pool"
                    };
                }
            } catch (error) {
                console.error("Error syncing user to GNS3:", error);
                set.status = 500;
                return {
                    status: "error",
                    message: `Sync failed: ${(error as Error).message}`
                };
            }
        },
        {
            beforeHandle: requireRole(["ADMIN", "INSTRUCTOR"]),
            params: t.Object({
                userId: t.String()
            }),
            detail: {
                tags: ["Admin"],
                summary: "Sync a single user to GNS3",
                description: "Creates a GNS3 user and resource pool for an existing MongoDB user"
            }
        }
    )

    // Sync all users to GNS3
    .post(
        "/all",
        async ({ query, set }) => {
            try {
                const dryRun = query.dryRun === "true";
                const roleFilter = query.role || "STUDENT"; // Default to students only

                // Find all users with the specified role
                const users = await User.find({ role: roleFilter });

                if (users.length === 0) {
                    return {
                        status: "success",
                        message: `No users found with role "${roleFilter}"`,
                        data: { total: 0, synced: 0, failed: 0, skipped: 0 }
                    };
                }

                if (dryRun) {
                    return {
                        status: "success",
                        message: `Dry run: Would sync ${users.length} users with role "${roleFilter}"`,
                        data: {
                            total: users.length,
                            users: users.map(u => ({
                                u_id: u.u_id,
                                fullName: u.fullName,
                                gns3Username: `it${u.u_id}`,
                                gns3PoolName: `it${u.u_id}-pool`
                            }))
                        }
                    };
                }

                // Sync each user
                const results: {
                    synced: { u_id: string; gns3Username: string }[];
                    failed: { u_id: string; error: string }[];
                    skipped: { u_id: string; reason: string }[];
                } = {
                    synced: [],
                    failed: [],
                    skipped: []
                };

                for (const user of users) {
                    try {
                        const tempPassword = generateTempPassword();

                        const result = await AuthService.createGNS3UserAndPool(
                            user.u_id,
                            user.fullName || user.u_id,
                            tempPassword
                        );

                        if (result.success) {
                            // DEEP2-7: Do not include tempPassword in response
                            results.synced.push({
                                u_id: user.u_id,
                                gns3Username: `it${user.u_id}`,
                            });
                        } else {
                            // Check if the error indicates the user already exists
                            if (result.error?.includes("already") || result.error?.includes("409")) {
                                results.skipped.push({
                                    u_id: user.u_id,
                                    reason: "User or pool already exists in GNS3"
                                });
                            } else {
                                results.failed.push({
                                    u_id: user.u_id,
                                    error: result.error || "Unknown error"
                                });
                            }
                        }
                    } catch (error) {
                        results.failed.push({
                            u_id: user.u_id,
                            error: (error as Error).message
                        });
                    }
                }

                return {
                    status: "success",
                    message: `Sync completed: ${results.synced.length} synced, ${results.failed.length} failed, ${results.skipped.length} skipped`,
                    data: {
                        total: users.length,
                        synced: results.synced.length,
                        failed: results.failed.length,
                        skipped: results.skipped.length,
                        details: results
                    }
                };
            } catch (error) {
                console.error("Error syncing all users to GNS3:", error);
                set.status = 500;
                return {
                    status: "error",
                    message: `Sync failed: ${(error as Error).message}`
                };
            }
        },
        {
            beforeHandle: requireRole(["ADMIN"]),
            query: t.Object({
                dryRun: t.Optional(t.String()),
                role: t.Optional(t.String())
            }),
            detail: {
                tags: ["Admin"],
                summary: "Sync all users to GNS3",
                description: "Creates GNS3 users and resource pools for all existing users. Use dryRun=true to preview. Use role=STUDENT|INSTRUCTOR|VIEWER to filter."
            }
        }
    )

    // Check GNS3 connection status
    .get(
        "/status",
        async ({ set }) => {
            try {
                const { GNS3v3Service } = await import("../gns3-student-lab/service");
                const loginResult = await GNS3v3Service.login();

                if (loginResult.success) {
                    return {
                        status: "success",
                        message: "GNS3 server is reachable and credentials are valid",
                        data: {
                            connected: true
                        }
                    };
                } else {
                    set.status = 503;
                    return {
                        status: "error",
                        message: loginResult.error || "Failed to connect to GNS3",
                        data: {
                            connected: false
                        }
                    };
                }
            } catch (error) {
                set.status = 500;
                return {
                    status: "error",
                    message: `GNS3 connection check failed: ${(error as Error).message}`,
                    data: {
                        connected: false
                    }
                };
            }
        },
        {
            beforeHandle: requireRole(["ADMIN", "INSTRUCTOR"]),
            detail: {
                tags: ["Admin"],
                summary: "Check GNS3 connection status",
                description: "Verifies that the backend can connect to the GNS3 server with admin credentials"
            }
        }
    );

/**
 * DEEP2-13: Generate a temporary password using cryptographically secure random bytes
 */
function generateTempPassword(): string {
    return crypto.randomBytes(12).toString("base64url");
}
