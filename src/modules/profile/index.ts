import { Elysia, t } from 'elysia';
import { ProfileService } from './service.js';
import { authPlugin } from '../../plugins/plugins.js';

/**
 * Profile Routes
 * Handles profile viewing and updating
 */
export const profileRoutes = new Elysia({ prefix: '/profile' })
    .use(authPlugin)

    /**
     * Get own profile
     * GET /profile
     */
    .get(
        '/',
        async ({ authPlugin, set }) => {
            try {
                if (!authPlugin) {
                    set.status = 401;
                    return { error: 'Unauthorized' };
                }

                const { u_id } = authPlugin;
                const profile = await ProfileService.getProfile(u_id);

                if (!profile) {
                    set.status = 404;
                    return { error: 'Profile not found' };
                }

                return {
                    success: true,
                    data: profile,
                };
            } catch (error) {
                console.error('Error getting profile:', error);
                set.status = 500;
                return {
                    error: 'Failed to get profile',
                    details: error instanceof Error ? error.message : 'Unknown error',
                };
            }
        },
        {
            detail: {
                summary: 'Get own profile',
                description: 'Get the authenticated user\'s profile information including presigned URL for profile picture',
                tags: ['Profile'],
            },
        }
    )

    /**
     * Get public profile by user ID
     * GET /profile/:userId
     */
    .get(
        '/:userId',
        async ({ params, authPlugin, set }) => {
            try {
                if (!authPlugin) {
                    set.status = 401;
                    return { error: 'Unauthorized' };
                }

                const { userId } = params;
                const profile = await ProfileService.getPublicProfile(userId);

                if (!profile) {
                    set.status = 404;
                    return { error: 'User not found' };
                }

                return {
                    success: true,
                    data: profile,
                };
            } catch (error) {
                console.error('Error getting public profile:', error);
                set.status = 500;
                return {
                    error: 'Failed to get profile',
                    details: error instanceof Error ? error.message : 'Unknown error',
                };
            }
        },
        {
            params: t.Object({
                userId: t.String(),
            }),
            detail: {
                summary: 'Get public profile',
                description: 'Get another user\'s public profile information',
                tags: ['Profile'],
            },
        }
    )

    /**
     * Update bio
     * PUT /profile/bio
     */
    .put(
        '/bio',
        async ({ body, authPlugin, set }) => {
            try {
                if (!authPlugin) {
                    set.status = 401;
                    return { error: 'Unauthorized' };
                }

                const { u_id } = authPlugin;
                const { bio } = body;

                const result = await ProfileService.updateBio(u_id, bio);

                if (!result.success) {
                    set.status = 400;
                    return { error: result.message };
                }

                return {
                    success: true,
                    message: result.message,
                    data: { bio: result.bio },
                };
            } catch (error) {
                console.error('Error updating bio:', error);
                set.status = 500;
                return {
                    error: 'Failed to update bio',
                    details: error instanceof Error ? error.message : 'Unknown error',
                };
            }
        },
        {
            body: t.Object({
                bio: t.String({ maxLength: 500 }),
            }),
            detail: {
                summary: 'Update bio',
                description: 'Update the authenticated user\'s bio (max 500 characters)',
                tags: ['Profile'],
            },
        }
    );
