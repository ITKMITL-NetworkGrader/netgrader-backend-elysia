import { Elysia, t } from 'elysia';
import { storageService, MAX_FILE_SIZE } from '../../services/storage.js';
import { User } from '../auth/model.js';
import { Course } from '../courses/model.js';
import { authPlugin } from '../../plugins/plugins.js';

/**
 * Storage Routes
 * Handles file upload/download for profile pictures and course banners
 */

export const storageRoutes = new Elysia({ prefix: '/storage' })
  .use(authPlugin)
  /**
   * Upload profile picture
   * POST /storage/profile
   */
  .post(
    '/profile',
    async ({ body, authPlugin, set }) => {
      try {
        if (!authPlugin) {
          set.status = 401;
          return { error: 'Unauthorized' };
        }
        const { u_id } = authPlugin ?? { u_id: "" };
        const { file } = body;

        // Validate file
        if (!file || !(file instanceof File)) {
          set.status = 400;
          return { error: 'No file provided' };
        }

        // Check file size
        if (file.size > MAX_FILE_SIZE.PROFILE) {
          set.status = 400;
          return {
            error: `File size exceeds maximum allowed size of ${MAX_FILE_SIZE.PROFILE / (1024 * 1024)} MB`,
          };
        }

        // Validate content type
        if (!file.type.startsWith('image/')) {
          set.status = 400;
          return { error: 'Only image files are allowed' };
        }

        // Convert file to buffer
        const arrayBuffer = await file.arrayBuffer();
        const fileBuffer = Buffer.from(arrayBuffer);

        // Delete old profile picture if exists
        await storageService.deleteProfilePicture(u_id);

        // Upload new profile picture
        const result = await storageService.uploadProfilePicture(
          u_id,
          fileBuffer,
          file.type
        );

        // Update user in database with object path (not presigned URL)
        await User.findOneAndUpdate(
          { u_id },
          { profilePicture: result.objectPath }
        );

        // Generate presigned URL for immediate response
        const presignedUrl = await storageService.getPresignedUrl(result.objectPath);

        return {
          message: 'Profile picture uploaded successfully',
          data: {
            objectName: result.objectName,
            url: presignedUrl,
          },
        };
      } catch (error) {
        console.error('Error uploading profile picture:', error);
        set.status = 500;
        return {
          error: 'Failed to upload profile picture',
          details: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    },
    {
      body: t.Object({
        file: t.File({
          type: ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'],
          maxSize: MAX_FILE_SIZE.PROFILE,
        }),
      }),
      detail: {
        summary: 'Upload profile picture',
        description: 'Upload a profile picture for the authenticated user',
        tags: ['Storage'],
      },
    }
  )

  /**
   * Delete profile picture
   * DELETE /storage/profile
   */
  .delete('/profile', async ({ authPlugin, set }) => {
    try {
      if (!authPlugin) {
        set.status = 401;
        return { error: 'Unauthorized' };
      }
      const { u_id } = authPlugin ?? { u_id: "" };
      // Delete profile picture
      await storageService.deleteProfilePicture(u_id);

      // Update user in database
      await User.findOneAndUpdate(
        { u_id },
        { $unset: { profilePicture: 1 } }
      );

      return {
        message: 'Profile picture deleted successfully',
      };
    } catch (error) {
      console.error('Error deleting profile picture:', error);
      set.status = 500;
      return {
        error: 'Failed to delete profile picture',
        details: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  })

  /**
   * Upload course banner
   * POST /storage/course/:courseId/banner
   */
  .post(
    '/course/:courseId/banner',
    async ({ params, body, authPlugin, set }) => {
      try {
        if (!authPlugin) {
          set.status = 401;
          return { error: 'Unauthorized' };
        }
        const { u_id, role } = authPlugin ?? { u_id: "", role: "STUDENT" };
        const { courseId } = params;
        const { file } = body;

        // Check if course exists and user is the creator or admin
        const course = await Course.findById(courseId);
        if (!course) {
          set.status = 404;
          return { error: 'Course not found' };
        }

        if (course.created_by !== u_id && role !== 'ADMIN') {
          set.status = 403;
          return { error: 'You do not have permission to upload banner for this course' };
        }

        // Validate file
        if (!file || !(file instanceof File)) {
          set.status = 400;
          return { error: 'No file provided' };
        }

        // Check file size
        if (file.size > MAX_FILE_SIZE.COURSE_BANNER) {
          set.status = 400;
          return {
            error: `File size exceeds maximum allowed size of ${MAX_FILE_SIZE.COURSE_BANNER / (1024 * 1024)} MB`,
          };
        }

        // Validate content type
        if (!file.type.startsWith('image/')) {
          set.status = 400;
          return { error: 'Only image files are allowed' };
        }

        // Convert file to buffer
        const arrayBuffer = await file.arrayBuffer();
        const fileBuffer = Buffer.from(arrayBuffer);

        // Delete old banner if exists
        await storageService.deleteCourseBanner(courseId);

        // Upload new banner
        const result = await storageService.uploadCourseBanner(
          courseId,
          fileBuffer,
          file.type
        );

        // Update course in database with object path (not presigned URL)
        await Course.findByIdAndUpdate(courseId, { bannerUrl: result.objectPath });

        // Generate presigned URL for immediate response
        const presignedUrl = await storageService.getPresignedUrl(result.objectPath);

        return {
          message: 'Course banner uploaded successfully',
          data: {
            objectName: result.objectName,
            url: presignedUrl,
          },
        };
      } catch (error) {
        console.error('Error uploading course banner:', error);
        set.status = 500;
        return {
          error: 'Failed to upload course banner',
          details: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    },
    {
      params: t.Object({
        courseId: t.String(),
      }),
      body: t.Object({
        file: t.File({
          type: ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'],
          maxSize: MAX_FILE_SIZE.COURSE_BANNER,
        }),
      }),
      detail: {
        summary: 'Upload course banner',
        description: 'Upload a banner image for a course',
        tags: ['Storage'],
      },
    }
  )

  /**
   * Delete course banner
   * DELETE /storage/course/:courseId/banner
   */
  .delete(
    '/course/:courseId/banner',
    async ({ params, authPlugin, set }) => {
      try {
        if (!authPlugin) {
          set.status = 401;
          return { error: 'Unauthorized' };
        }
        const { u_id, role } = authPlugin ?? { u_id: "", role: "STUDENT" };
        const { courseId } = params;

        // Check if course exists and user is the creator or admin
        const course = await Course.findById(courseId);
        if (!course) {
          set.status = 404;
          return { error: 'Course not found' };
        }

        if (course.created_by !== u_id && role !== 'ADMIN') {
          set.status = 403;
          return { error: 'You do not have permission to delete banner for this course' };
        }

        // Delete banner
        await storageService.deleteCourseBanner(courseId);

        // Update course in database
        await Course.findByIdAndUpdate(courseId, { $unset: { bannerUrl: 1 } });

        return {
          message: 'Course banner deleted successfully',
        };
      } catch (error) {
        console.error('Error deleting course banner:', error);
        set.status = 500;
        return {
          error: 'Failed to delete course banner',
          details: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    },
    {
      params: t.Object({
        courseId: t.String(),
      }),
      detail: {
        summary: 'Delete course banner',
        description: 'Delete the banner image for a course',
        tags: ['Storage'],
      },
    }
  )

  /**
   * Get file URL (for testing purposes)
   * GET /storage/url/:path
   */
  .get(
    '/url/:path',
    async ({ params, set }) => {
      try {
        const { path } = params;
        const url = await storageService.getPresignedUrl(path);

        return {
          url,
        };
      } catch (error) {
        console.error('Error getting file URL:', error);
        set.status = 500;
        return {
          error: 'Failed to get file URL',
          details: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    },
    {
      params: t.Object({
        path: t.String(),
      }),
      detail: {
        summary: 'Get presigned URL for a file',
        description: 'Get a presigned URL for accessing a file in MinIO',
        tags: ['Storage'],
      },
    }
  );
