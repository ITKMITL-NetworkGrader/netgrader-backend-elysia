import { Elysia, t } from "elysia";
import { GNS3Service } from "./service";
import { authPlugin, requireRole } from "../../plugins/plugins";

// R4-2/R4-4: Removed weak isAllowedServerIp — validateGNS3Target in service.ts is the single SSRF gate

export const gns3Routes = new Elysia({ prefix: "/playground/gns3" })
    .use(authPlugin)

    /**
     * Test connectivity to a GNS3 server
     */
    .post(
        "/test-connectivity",
        async ({ body, set }) => {
            const config = {
                serverIp: body.serverIp,
                serverPort: body.serverPort,
                auth: body.requiresAuth ? {
                    username: body.username || '',
                    password: body.password || '',
                } : undefined,
            };

            const result = await GNS3Service.testConnectivity(config);

            if (!result.success) {
                set.status = 400;
                return {
                    success: false,
                    error: result.error,
                };
            }

            return {
                success: true,
                version: result.version,
                message: `Successfully connected to GNS3 server v${result.version}`,
            };
        },
        {
            beforeHandle: requireRole(["ADMIN", "INSTRUCTOR"]),
            body: t.Object({
                serverIp: t.String({ minLength: 1 }),
                serverPort: t.Number({ minimum: 1, maximum: 65535 }),
                requiresAuth: t.Optional(t.Boolean()),
                username: t.Optional(t.String()),
                password: t.Optional(t.String()),
            }),
            detail: {
                tags: ["Playground"],
                summary: "Test GNS3 Server Connectivity",
                description: "Test connection to a GNS3 server with optional authentication",
            },
        }
    )

    /**
     * Create a new project on GNS3 server
     */
    .post(
        "/create-project",
        async ({ body, set }) => {
            const config = {
                serverIp: body.serverIp,
                serverPort: body.serverPort,
                auth: body.requiresAuth ? {
                    username: body.username || '',
                    password: body.password || '',
                } : undefined,
            };

            const result = await GNS3Service.createProject(config, body.projectName);

            if (!result.success) {
                set.status = 400;
                return {
                    success: false,
                    error: result.error,
                };
            }

            return {
                success: true,
                projectId: result.projectId,
                projectName: result.projectName,
                isExisting: result.isExisting || false,
                message: result.isExisting
                    ? `Using existing project "${result.projectName}"`
                    : `Project "${result.projectName}" created successfully`,
            };
        },
        {
            beforeHandle: requireRole(["ADMIN", "INSTRUCTOR"]),
            body: t.Object({
                serverIp: t.String({ minLength: 1 }),
                serverPort: t.Number({ minimum: 1, maximum: 65535 }),
                projectName: t.String({ minLength: 1 }),
                requiresAuth: t.Optional(t.Boolean()),
                username: t.Optional(t.String()),
                password: t.Optional(t.String()),
            }),
            detail: {
                tags: ["Playground"],
                summary: "Create GNS3 Project",
                description: "Create a new project on the GNS3 server for playground testing",
            },
        }
    )

    /**
     * Open/activate a project on GNS3 server
     */
    .post(
        "/open-project",
        async ({ body, set }) => {
            const config = {
                serverIp: body.serverIp,
                serverPort: body.serverPort,
                auth: body.requiresAuth ? {
                    username: body.username || '',
                    password: body.password || '',
                } : undefined,
            };

            const result = await GNS3Service.openProject(config, body.projectId);

            if (!result.success) {
                set.status = 400;
                return {
                    success: false,
                    error: result.error,
                };
            }

            return {
                success: true,
                message: `Project opened successfully`,
            };
        },
        {
            beforeHandle: requireRole(["ADMIN", "INSTRUCTOR"]),
            body: t.Object({
                serverIp: t.String({ minLength: 1 }),
                serverPort: t.Number({ minimum: 1, maximum: 65535 }),
                projectId: t.String({ minLength: 1 }),
                requiresAuth: t.Optional(t.Boolean()),
                username: t.Optional(t.String()),
                password: t.Optional(t.String()),
            }),
            detail: {
                tags: ["Playground"],
                summary: "Open GNS3 Project",
                description: "Open/activate a project on the GNS3 server",
            },
        }
    )

    /**
     * List all projects on GNS3 server
     */
    .post(
        "/list-projects",
        async ({ body, set }) => {
            const config = {
                serverIp: body.serverIp,
                serverPort: body.serverPort,
                auth: body.requiresAuth ? {
                    username: body.username || '',
                    password: body.password || '',
                } : undefined,
            };

            const result = await GNS3Service.listProjects(config);

            if (!result.success) {
                set.status = 400;
                return {
                    success: false,
                    error: result.error,
                };
            }

            return {
                success: true,
                projects: result.projects,
            };
        },
        {
            beforeHandle: requireRole(["ADMIN", "INSTRUCTOR"]),
            body: t.Object({
                serverIp: t.String({ minLength: 1 }),
                serverPort: t.Number({ minimum: 1, maximum: 65535 }),
                requiresAuth: t.Optional(t.Boolean()),
                username: t.Optional(t.String()),
                password: t.Optional(t.String()),
            }),
            detail: {
                tags: ["Playground"],
                summary: "List GNS3 Projects",
                description: "List all projects on the GNS3 server",
            },
        }
    )

    /**
     * List nodes in a GNS3 project
     */
    .post(
        "/list-nodes",
        async ({ body, set }) => {
            const config = {
                serverIp: body.serverIp,
                serverPort: body.serverPort,
                auth: body.requiresAuth ? {
                    username: body.username || '',
                    password: body.password || '',
                } : undefined,
            };

            const result = await GNS3Service.listNodes(config, body.projectId);

            if (!result.success) {
                set.status = 400;
                return {
                    success: false,
                    error: result.error,
                };
            }

            return {
                success: true,
                nodes: result.nodes,
            };
        },
        {
            beforeHandle: requireRole(["ADMIN", "INSTRUCTOR"]),
            body: t.Object({
                serverIp: t.String({ minLength: 1 }),
                serverPort: t.Number({ minimum: 1, maximum: 65535 }),
                projectId: t.String({ minLength: 1 }),
                requiresAuth: t.Optional(t.Boolean()),
                username: t.Optional(t.String()),
                password: t.Optional(t.String()),
            }),
            detail: {
                tags: ["Playground"],
                summary: "List GNS3 Nodes",
                description: "List all nodes in a GNS3 project",
            },
        }
    );
