import { Elysia, t } from "elysia";
import { GNS3v3Service } from "./service";
import { authPlugin } from "../../plugins/plugins";
import { User } from "../auth/model";

export const gns3StudentLabRoutes = new Elysia({ prefix: "/student-lab/gns3" })
    .use(authPlugin)

    /**
     * Complete student lab setup workflow with Lazy Initialization
     * 
     * - Automatically creates GNS3 user if not exists
     * - Automatically creates pool if not exists
     * - Automatically creates ACE if not exists
     * - Creates project and adds to pool
     * - Uses consistent server sharding based on student ID
     */
    .post(
        "/setup",
        async ({ body, set }) => {
            // Find user in MongoDB
            const user = await User.findOne({ u_id: body.studentId.toLowerCase() });
            if (!user) {
                set.status = 404;
                return {
                    success: false,
                    error: `User "${body.studentId}" not found in the system`,
                };
            }

            // Setup lab with lazy initialization
            const result = await GNS3v3Service.setupStudentLab(
                body.studentId,
                body.courseName,
                body.labName,
                user.fullName || body.studentId,
                user.gns3ServerIndex  // undefined if not yet assigned
            );

            if (!result.success) {
                set.status = 400;
                return {
                    success: false,
                    error: result.error,
                };
            }

            // Store server index if newly assigned
            if (user.gns3ServerIndex === undefined && result.serverIndex !== undefined) {
                await User.updateOne(
                    { _id: user._id },
                    { gns3ServerIndex: result.serverIndex }
                );
                console.log(`[GNS3] Stored server index ${result.serverIndex} for user ${body.studentId}`);
            }

            return {
                success: true,
                credentials: result.credentials,
                loginUrl: result.loginUrl,
                projectUrl: result.projectUrl,
                projectId: result.projectId,
                projectName: result.projectName,
                serverIndex: result.serverIndex,
            };
        },
        {
            body: t.Object({
                studentId: t.String({ minLength: 1 }),
                courseName: t.String({ minLength: 1 }),
                labName: t.String({ minLength: 1 }),
            }),
            detail: {
                tags: ["Student Lab"],
                summary: "Setup Student GNS3 Lab",
                description: "Creates GNS3 user/pool/ACE if needed, creates project, and returns access credentials. Uses server sharding for load balancing.",
            },
        }
    );
