/**
 * ContainerLab Playground Routes
 *
 * Provides API endpoints for instructors to configure and interact with
 * clab-api-server during playground testing. Mirrors the old /playground/gns3/* routes.
 */

import { Elysia, t } from 'elysia';
import { ClabApiOrchestrator } from './service';
import { authPlugin, requireRole } from '../../plugins/plugins';
import type { ClabConfig } from './orchestrator';

/**
 * Instantiate an orchestrator from a request body containing server config.
 */
function orchestratorFromBody(body: {
    serverIp: string;
    serverPort: number;
    username: string;
    password: string;
}): ClabApiOrchestrator {
    const config: ClabConfig = {
        serverIp: body.serverIp,
        serverPort: body.serverPort,
        adminUsername: body.username,
        adminPassword: body.password,
    };
    return new ClabApiOrchestrator(config);
}

async function runClabAction<T>(
    body: {
        serverIp: string;
        serverPort: number;
        username: string;
        password: string;
    },
    set: { status?: number | string },
    action: (orchestrator: ClabApiOrchestrator) => Promise<T>,
    failurePrefix: string,
): Promise<T | { success: false; error: string }> {
    try {
        const orchestrator = orchestratorFromBody(body);
        const result = await action(orchestrator);

        if (
            typeof result === 'object' &&
            result !== null &&
            'success' in result &&
            (result as { success: boolean }).success === false
        ) {
            set.status = 502;
        }

        return result;
    } catch (error) {
        set.status = 500;
        return {
            success: false,
            error: `${failurePrefix}: ${(error as Error).message}`,
        };
    }
}

export const clabRoutes = new Elysia({ prefix: '/playground/clab' })
    .use(authPlugin)

    // ─── Test connectivity ──────────────────────────────────────────────

    .post(
        '/test-connectivity',
        async ({ body, set }) => {
            return runClabAction(
                body,
                set,
                (orchestrator) => orchestrator.testConnectivity(),
                'Connectivity test failed',
            );
        },
        {
            body: t.Object({
                serverIp: t.String(),
                serverPort: t.Number(),
                username: t.String(),
                password: t.String(),
            }),
            beforeHandle: requireRole(['ADMIN', 'INSTRUCTOR']),
            detail: {
                tags: ['ContainerLab'],
                summary: 'Test clab-api-server connectivity',
                description:
                    'Verify that the clab-api-server is reachable and admin credentials are valid.',
            },
        },
    )

    // ─── Deploy lab ─────────────────────────────────────────────────────

    .post(
        '/deploy-lab',
        async ({ body, set }) => {
            return runClabAction(
                body,
                set,
                (orchestrator) => orchestrator.deployLab(body.topology),
                'Deploy failed',
            );
        },
        {
            body: t.Object({
                serverIp: t.String(),
                serverPort: t.Number(),
                username: t.String(),
                password: t.String(),
                topology: t.Object({
                    name: t.String(),
                    topology: t.Object({
                        kinds: t.Optional(t.Record(t.String(), t.Any())),
                        nodes: t.Record(t.String(), t.Any()),
                        links: t.Optional(t.Array(t.Object({
                            endpoints: t.Tuple([t.String(), t.String()]),
                        }))),
                    }),
                }),
            }),
            beforeHandle: requireRole(['ADMIN', 'INSTRUCTOR']),
            detail: {
                tags: ['ContainerLab'],
                summary: 'Deploy a lab topology',
                description:
                    'Deploy a ContainerLab topology definition on the clab-api-server.',
            },
        },
    )

    // ─── List labs ───────────────────────────────────────────────────────

    .post(
        '/list-labs',
        async ({ body, set }) => {
            return runClabAction(
                body,
                set,
                (orchestrator) => orchestrator.listLabs(),
                'List labs failed',
            );
        },
        {
            body: t.Object({
                serverIp: t.String(),
                serverPort: t.Number(),
                username: t.String(),
                password: t.String(),
            }),
            beforeHandle: requireRole(['ADMIN', 'INSTRUCTOR']),
            detail: {
                tags: ['ContainerLab'],
                summary: 'List deployed labs',
                description:
                    'List all labs currently deployed on the clab-api-server.',
            },
        },
    )

    // ─── Inspect lab ────────────────────────────────────────────────────

    .post(
        '/inspect-lab',
        async ({ body, set }) => {
            return runClabAction(
                body,
                set,
                (orchestrator) => orchestrator.inspectLab(body.labName),
                'Inspect failed',
            );
        },
        {
            body: t.Object({
                serverIp: t.String(),
                serverPort: t.Number(),
                username: t.String(),
                password: t.String(),
                labName: t.String(),
            }),
            beforeHandle: requireRole(['ADMIN', 'INSTRUCTOR']),
            detail: {
                tags: ['ContainerLab'],
                summary: 'Inspect a deployed lab',
                description:
                    'Get node/container details for a deployed lab.',
            },
        },
    )

    // ─── Destroy lab ─────────────────────────────────────────────────────

    .post(
        '/destroy-lab',
        async ({ body, set }) => {
            return runClabAction(
                body,
                set,
                (orchestrator) => orchestrator.destroyLab(body.labName),
                'Destroy failed',
            );
        },
        {
            body: t.Object({
                serverIp: t.String(),
                serverPort: t.Number(),
                username: t.String(),
                password: t.String(),
                labName: t.String(),
            }),
            beforeHandle: requireRole(['ADMIN', 'INSTRUCTOR']),
            detail: {
                tags: ['ContainerLab'],
                summary: 'Destroy a deployed lab',
                description:
                    'Destroy a running ContainerLab topology on the clab-api-server.',
            },
        },
    )

    // ─── Exec command on a node ───────────────────────────────────────────────

    .post(
        '/exec-node',
        async ({ body, set }) => {
            console.log(body)
            return runClabAction(
                body,
                set,
                (orchestrator) => orchestrator.execCommand(body.labName, body.command, body.nodeName),
                'Exec failed',
            );
        },
        {
            body: t.Object({
                serverIp: t.String(),
                serverPort: t.Number(),
                username: t.String(),
                password: t.String(),
                labName: t.String(),
                nodeName: t.String(),
                command: t.String(),
            }),
            beforeHandle: requireRole(['ADMIN', 'INSTRUCTOR']),
            detail: {
                tags: ['ContainerLab'],
                summary: 'Execute a command on a lab node',
                description:
                    'Run a command on a specific node via the clab-api-server exec API. Returns stdout/stderr.',
            },
        },
    )

    // ─── Request SSH proxy access to a node ───────────────────────────────────

    .post(
        '/get-ssh-proxy',
        async ({ body, set }) => {
            return runClabAction(
                body,
                set,
                (orchestrator) => orchestrator.getSSHProxyInfo(body.labName, body.nodeName, {
                    duration: body.duration,
                    sshUsername: body.sshUsername,
                }),
                'SSH proxy request failed',
            );
        },
        {
            body: t.Object({
                serverIp: t.String(),
                serverPort: t.Number(),
                username: t.String(),
                password: t.String(),
                labName: t.String(),
                nodeName: t.String(),
                duration: t.Optional(t.String()),
                sshUsername: t.Optional(t.String()),
            }),
            beforeHandle: requireRole(['ADMIN', 'INSTRUCTOR']),
            detail: {
                tags: ['ContainerLab'],
                summary: 'Request SSH proxy access to a node',
                description:
                    'Allocate an SSH proxy port on the clab-api-server for direct SSH access to a specific lab node.',
            },
        },
    );
