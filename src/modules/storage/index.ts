import { Elysia, t } from 'elysia';
import { storageService, MAX_FILE_SIZE } from '../../services/storage.js';
import { User } from '../auth/model.js';
import { Course } from '../courses/model.js';
import { authPlugin } from '../../plugins/plugins.js';
import { v4 as uuidv4 } from 'uuid';

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

        };
      }
    },
    {
      body: t.Object({
        file: t.File({
          type: ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'],
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

        };
      }
    },
    {
      params: t.Object({
        courseId: t.String(),
      }),
      body: t.Object({
        file: t.File({
          type: ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'],
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

  // DEEP2-4: Open presigned URL endpoint removed for security

  /**
   * Serve images through authenticated proxy (no expiry issues)
   * GET /storage/serve/:path
   */
  .get(
    '/serve/*',
    async ({ params, authPlugin, set, path }) => {
      try {
        // Validate authentication
        if (!authPlugin) {
          set.status = 401
          return { error: 'Unauthorized' }
        }

        // Get the object path from wildcard
        const objectPath = params['*']
        if (!objectPath) {
          set.status = 400
          return { error: 'No path specified' }
        }

        // Security: Only allow specific prefixes
        const allowedPrefixes = ['editor/', 'profiles/', 'courses/']
        const isAllowed = allowedPrefixes.some(prefix => objectPath.startsWith(prefix))
        if (!isAllowed) {
          set.status = 403
          return { error: 'Access denied' }
        }

        // Get object from MinIO
        try {
          const objectData = await storageService.getObject(objectPath)

          // Set appropriate content type
          const ext = objectPath.split('.').pop()?.toLowerCase()
          const contentTypes: Record<string, string> = {
            jpg: 'image/jpeg',
            jpeg: 'image/jpeg',
            png: 'image/png',
            gif: 'image/gif',
            webp: 'image/webp',
          }
          const contentType = contentTypes[ext || ''] || 'application/octet-stream'

          set.headers['Content-Type'] = contentType
          set.headers['Content-Disposition'] = 'inline'

          return objectData
        } catch (err) {
          console.error('Error fetching object:', err)
          set.status = 404
          return { error: 'Image not found' }
        }
      } catch (error) {
        console.error('Error in serve endpoint:', error)
        set.status = 500
        return { error: 'Failed to serve image' }
      }
    },
    {
      detail: {
        summary: 'Serve image through authenticated proxy',
        description: 'Stream images through authenticated endpoint (no expiry)',
        tags: ['Storage'],
      },
    }
  )

  /**
   * Upload editor image (for rich text editor)
   * POST /storage/editor-image
   */
  .post(
    '/editor-image',
    async ({ body, authPlugin, set }) => {
      try {
        // Allow unauthenticated uploads for editor images (limited scope)
        const { file } = body;

        // Validate file
        if (!file || !(file instanceof File)) {
          set.status = 400;
          return { error: 'No file provided' };
        }

        // Check file size (2MB limit for editor images)
        const maxSize = 2 * 1024 * 1024;
        if (file.size > maxSize) {
          set.status = 400;
          return {
            error: `File size exceeds maximum allowed size of ${maxSize / (1024 * 1024)} MB`,
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

        // Generate unique filename
        const extension = file.name.split('.').pop() || 'jpg';
        const fileName = `editor-${uuidv4()}.${extension}`;
        const objectPath = `editor/${fileName}`;

        // Upload to MinIO
        const result = await storageService.uploadFile(
          objectPath,
          fileBuffer,
          { contentType: file.type }
        );

        // Return presigned URL with 7-day expiry for persistent student access
        const presignedUrl = await storageService.getPresignedUrl(result.objectPath, 604800); // 7 days

        return {
          success: true,
          data: {
            url: presignedUrl, // For immediate display in editor
            path: result.objectPath, // For storage in markdown (persistent)
            filename: fileName,
            originalName: file.name,
            size: file.size,
            type: file.type
          }
        };
      } catch (error) {
        console.error('Error uploading editor image:', error);
        set.status = 500;
        return {
          error: 'Failed to upload editor image',
        };
      }
    },
    {
      body: t.Object({
        file: t.File({
          type: ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'],
          maxSize: 2 * 1024 * 1024, // 2MB
        }),
      }),
      detail: {
        summary: 'Upload editor image',
        description: 'Upload an image for use in the rich text editor',
        tags: ['Storage'],
      },
    }
  )

  /**
   * Get presigned URLs for images (editor, profiles, course banners)
   * POST /storage/images/urls
   */
  .post(
    '/images/urls',
    async ({ body, set }) => {
      try {
        const { paths } = body as { paths: string[] };

        if (!paths || !Array.isArray(paths) || paths.length === 0) {
          set.status = 400;
          return { error: 'No paths provided' };
        }

        // Limit to 50 paths per request
        const limitedPaths = paths.slice(0, 50);

        const urls: Record<string, string> = {};
        for (const objectPath of limitedPaths) {
          // Validate path is from allowed prefixes
          const allowedPrefixes = ['editor/', 'profiles/', 'courses/'];
          const isAllowed = allowedPrefixes.some(prefix => objectPath.startsWith(prefix));

          if (!isAllowed) {
            continue;
          }

          try {
            const presignedUrl = await storageService.getPresignedUrl(objectPath, 604800); // 7 days
            urls[objectPath] = presignedUrl;
          } catch (err) {
            console.error(`Failed to generate URL for ${objectPath}:`, err);
            urls[objectPath] = '';
          }
        }

        return { success: true, data: urls };
      } catch (error) {
        console.error('Error getting image URLs:', error);
        set.status = 500;
        return { error: 'Failed to get image URLs' };
      }
    },
    {
      body: t.Object({
        paths: t.Array(t.String()),
      }),
      detail: {
        summary: 'Get presigned URLs for images',
        description: 'Get fresh presigned URLs for stored images (profiles, banners, editor images)',
        tags: ['Storage'],
      },
    }
  )
