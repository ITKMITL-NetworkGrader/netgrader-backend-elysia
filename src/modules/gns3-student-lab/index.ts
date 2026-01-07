import { Elysia, t } from "elysia";
import { GNS3v3Service } from "./service";
import { authPlugin } from "../../plugins/plugins";

export const gns3StudentLabRoutes = new Elysia({ prefix: "/student-lab/gns3" })
    .use(authPlugin)

    /**
     * Complete student lab setup workflow (Simplified)
     * 
     * Assumes user and pool already exist:
     * - Username: it<studentId>
     * - Pool: it<studentId>-pool
     * 
     * Creates project, adds to pool, creates ACE
     */
    .post(
        "/setup",
        async ({ body, set }) => {
            const result = await GNS3v3Service.setupStudentLab(
                body.studentId,
                body.courseName,
                body.labName
            );

            if (!result.success) {
                set.status = 400;
                return {
                    success: false,
                    error: result.error,
                };
            }

            return {
                success: true,
                credentials: result.credentials,
                projectUrl: result.projectUrl,
                projectId: result.projectId,
                projectName: result.projectName,
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
                description: "Creates project for existing user, adds to their pool, and creates ACE permissions",
            },
        }
    );
