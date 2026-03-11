import { User } from './model';

export type AuthRole = 'ADMIN' | 'INSTRUCTOR' | 'STUDENT';

export type RouteSet = {
    status?: number | string;
};

export type RouteAuthPlugin = {
    u_id?: string;
    role?: string;
} | undefined;

export type AuthContext = {
    user: Awaited<ReturnType<typeof User.findOne>>;
    userId: string;
    role: AuthRole;
};

/**
 * Resolve authenticated route context into a normalized user id and role.
 */
export async function resolveAuthContext(
    authPlugin: RouteAuthPlugin,
    set: RouteSet,
): Promise<AuthContext | { error: string }> {
    const userId = authPlugin?.u_id?.toLowerCase();
    const role = authPlugin?.role as AuthRole | undefined;

    if (!userId || !role) {
        set.status = 401;
        return { error: 'Unauthorized — missing auth context' };
    }

    const user = await User.findOne({ u_id: userId });
    if (!user) {
        set.status = 401;
        return { error: 'Unauthorized — user not found' };
    }

    return { user, userId, role };
}

/**
 * Enforce that student users can only act on their own user id.
 */
export function enforceSelfServiceUserAccess(
    authContext: AuthContext,
    requestedUserId: string,
    set: RouteSet,
): { userId: string } | { error: string } {
    if (authContext.role !== 'STUDENT') {
        return { userId: requestedUserId };
    }

    if (requestedUserId !== authContext.userId) {
        set.status = 403;
        return {
            error: 'Forbidden — students can only act on their own account',
        };
    }

    return { userId: authContext.userId };
}