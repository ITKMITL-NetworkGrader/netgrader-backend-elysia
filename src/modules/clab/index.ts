/**
 * ContainerLab Playground Routes
 *
 * Provides API endpoints for instructors to configure and interact with
 * clab-api-server during playground testing. Mirrors the old /playground/gns3/* routes.
 *
 * Credentials are read exclusively from server-side environment variables
 * (see src/config/clab.ts) — they are never accepted from request bodies.
 */

import { Elysia, t } from 'elysia';
import { ClabApiOrchestrator } from './service';
import { authPlugin, requireRole } from '../../plugins/plugins';
import { getClabConfig } from '../../config/clab';

function getOrchestrator(): ClabApiOrchestrator {
    return new ClabApiOrchestrator(getClabConfig());
}

async function runClabAction<T>(
    set: { status?: number | string },
    action: (orchestrator: ClabApiOrchestrator) => Promise<T>,
    failurePrefix: string,
): Promise<T | { success: false; error: string }> {
    try {
        const orchestrator = getOrchestrator();
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

    .get(
        '/test-connectivity',
        async ({ set }) => {
            return runClabAction(
                set,
                (orchestrator) => orchestrator.testConnectivity(),
                'Connectivity test failed',
            );
        },
        {
            beforeHandle: requireRole(['ADMIN', 'INSTRUCTOR']),
            detail: {
                tags: ['ContainerLab'],
                summary: 'Test clab-api-server connectivity',
                description:
                    'Verify that the clab-api-server (configured via env) is reachable and credentials are valid.',
            },
        },
    )

    // ─── Deploy lab ─────────────────────────────────────────────────────

    .post(
        '/deploy-lab',
        async ({ body, set }) => {
            return runClabAction(
                set,
                (orchestrator) => orchestrator.deployLab(body.topology),
                'Deploy failed',
            );
        },
        {
            body: t.Object({
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

    .get(
        '/list-labs',
        async ({ set }) => {
            return runClabAction(
                set,
                (orchestrator) => orchestrator.listLabs(),
                'List labs failed',
            );
        },
        {
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

    .get(
        '/inspect-lab/:labName',
        async ({ params, set }) => {
            return runClabAction(
                set,
                (orchestrator) => orchestrator.inspectLab(params.labName),
                'Inspect failed',
            );
        },
        {
            params: t.Object({ labName: t.String() }),
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

    .delete(
        '/labs/:labName',
        async ({ params, set }) => {
            return runClabAction(
                set,
                (orchestrator) => orchestrator.destroyLab(params.labName),
                'Destroy failed',
            );
        },
        {
            params: t.Object({ labName: t.String() }),
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
            return runClabAction(
                set,
                (orchestrator) => orchestrator.execCommand(body.labName, body.command, body.nodeName),
                'Exec failed',
            );
        },
        {
            body: t.Object({
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
