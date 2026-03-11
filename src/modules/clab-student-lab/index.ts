/**
 * ContainerLab Student Lab Routes
 *
 * Replaces /student-lab/gns3. Simplified from 7-step flow to 2-step:
 * 1. Deploy topology (admin-auth)
 * 2. Return SSH proxy access info
 *
 * Security:
 * - server selection is internal (single configured ContainerLab server)
 * - labName ownership verified via prefix match against authPlugin.u_id
 */

import { Elysia, t } from 'elysia';
import { ClabStudentLabService } from './service';
import { authPlugin, requireRole } from '../../plugins/plugins';
import {
    enforceSelfServiceUserAccess,
    resolveAuthContext,
    type AuthRole,
    type RouteAuthPlugin,
    type RouteSet,
} from '../auth/route-helpers.js';
import { User } from '../auth/model';
import { Lab } from '../labs/model';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Verify lab ownership: labName must start with the authenticated user's ID.
 * Lab names are generated as `<studentId>-<safe-lab-name>`.
 */
function verifyLabOwnership(
    labName: string,
    userId: string,
    role: AuthRole,
    set: RouteSet,
): { error: string } | null {
    if (role === 'ADMIN' || role === 'INSTRUCTOR') {
        return null;
    }

    if (!labName.startsWith(`${userId}-`)) {
        set.status = 403;
        return { error: 'Forbidden — lab does not belong to you' };
    }
    return null;
}

async function authorizeLabAccess(
    authPlugin: RouteAuthPlugin,
    labName: string,
    set: RouteSet,
): Promise<
    | { userId: string; role: AuthRole }
    | { error: string }
> {
    const authContext = await resolveAuthContext(authPlugin, set);
    if ('error' in authContext) {
        return authContext;
    }

    const ownershipError = verifyLabOwnership(
        labName,
        authContext.userId,
        authContext.role,
        set,
    );
    if (ownershipError) {
        return ownershipError;
    }

    return {
        userId: authContext.userId,
        role: authContext.role,
    };
}

// ─── Routes ──────────────────────────────────────────────────────────────────

export const clabStudentLabRoutes = new Elysia({
    prefix: '/student-lab/clab',
})
    .use(authPlugin)

    // ─── Setup student lab ──────────────────────────────────────────────

    .post(
        '/setup',
        async ({ body, set, authPlugin: auth }) => {
            const authContext = await resolveAuthContext(auth, set);
            if ('error' in authContext) {
                return {
                    success: false,
                    error: authContext.error,
                };
            }

            // Normalize studentId once
            const requestedStudentId = body.studentId.trim().toLowerCase();
            const setupAccess = enforceSelfServiceUserAccess(
                authContext,
                requestedStudentId,
                set,
            );
            if ('error' in setupAccess) {
                return {
                    success: false,
                    error:
                        setupAccess.error ===
                        'Forbidden — students can only act on their own account'
                            ? 'Forbidden — students can only setup their own lab'
                            : setupAccess.error,
                };
            }
            const { userId: studentId } = setupAccess;

            // Find user in MongoDB
            const studentUser =
                studentId === authContext.userId
                    ? authContext.user
                    : await User.findOne({ u_id: studentId });
            if (!studentUser) {
                set.status = 404;
                return {
                    success: false,
                    error: `User "${studentId}" not found in the system`,
                };
            }

            // Find lab in MongoDB
            const lab = await Lab.findById(body.labId);
            if (!lab) {
                set.status = 404;
                return {
                    success: false,
                    error: `Lab "${body.labId}" not found`,
                };
            }

            // Setup lab with admin-only auth
            const result = await ClabStudentLabService.setupStudentLab(
                studentId,
                lab,
            );

            if (!result.success) {
                const err = result.error || '';
                if (err.includes('STALE_TEMPLATES') || err.includes('deleted/missing templates')) {
                    set.status = 422;
                } else {
                    set.status = 400;
                }
                return { success: false, error: result.error };
            }

            return {
                success: true,
                labName: result.labName,
                nodes: result.nodes,
                sshAccess: result.sshAccess,
            };
        },
        {
            body: t.Object({
                studentId: t.String({ minLength: 1 }),
                labId: t.String({ minLength: 1 }),
            }),
            beforeHandle: requireRole(['ADMIN', 'INSTRUCTOR', 'STUDENT']),
            detail: {
                tags: ['Student Lab'],
                summary: 'Setup Student ContainerLab',
                description:
                    'Deploys a ContainerLab topology for the student. No student Linux users are created.',
            },
        },
    )

    // ─── Get SSH access info for existing lab ────────────────────────────

    .get(
        '/access/:labName',
        async ({ params, set, authPlugin: auth }) => {
            const access = await authorizeLabAccess(auth, params.labName, set);
            if ('error' in access) {
                return { success: false, error: access.error };
            }

            const result = await ClabStudentLabService.getStudentLabAccess(
                params.labName,
            );

            if (!result.success) {
                set.status = 404;
            }

            return result;
        },
        {
            params: t.Object({
                labName: t.String({ minLength: 1 }),
            }),
            beforeHandle: requireRole(['ADMIN', 'INSTRUCTOR', 'STUDENT']),
            detail: {
                tags: ['Student Lab'],
                summary: 'Get SSH access info for a deployed lab',
                description:
                    'Returns SSH proxy connection details. Lab ownership is verified for student users.',
            },
        },
    )

    // ─── Destroy student lab ────────────────────────────────────────────

    .delete(
        '/:labName',
        async ({ params, set, authPlugin: auth }) => {
            const access = await authorizeLabAccess(auth, params.labName, set);
            if ('error' in access) {
                return { success: false, error: access.error };
            }

            const result = await ClabStudentLabService.destroyStudentLab(
                params.labName,
            );

            if (!result.success) {
                set.status = 500;
            }

            return result;
        },
        {
            params: t.Object({
                labName: t.String({ minLength: 1 }),
            }),
            beforeHandle: requireRole(['ADMIN', 'INSTRUCTOR', 'STUDENT']),
            detail: {
                tags: ['Student Lab'],
                summary: 'Destroy a student lab',
                description:
                    'Tears down a deployed student lab. Only the lab owner can destroy it.',
            },
        },
    );
