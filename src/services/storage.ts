import { getMinioClient, BUCKET_NAME } from '../config/minio.js';
import * as Minio from 'minio';
import { Readable } from 'stream';

/**
 * Storage Service for MinIO
 * Handles file upload, download, and deletion operations
 */

export interface UploadOptions {
  contentType?: string;
  metadata?: Record<string, string>;
}

export interface UploadResult {
  objectName: string;
  etag: string;
  versionId?: string;
  objectPath: string; // MinIO object path (e.g., "courses/123/banner.jpg")
}

/**
 * Allowed image MIME types
 */
const ALLOWED_IMAGE_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
];

/**
 * Maximum file sizes (in bytes)
 */
export const MAX_FILE_SIZE = {
  PROFILE: 5 * 1024 * 1024, // 5 MB
  COURSE_BANNER: 10 * 1024 * 1024, // 10 MB
};

/**
 * Storage path prefixes
 */
export const STORAGE_PATHS = {
  PROFILES: 'profiles',
  COURSES: 'courses',
  TEMP: 'temp',
} as const;

export class StorageService {
  private client: Minio.Client;

  constructor() {
    this.client = getMinioClient();
  }

  /**
   * Validate file type
   */
  private validateFileType(contentType: string): boolean {
    return ALLOWED_IMAGE_TYPES.includes(contentType.toLowerCase());
  }

  /**
   * Get file extension from content type
   */
  private getFileExtension(contentType: string): string {
    const typeMap: Record<string, string> = {
      'image/jpeg': 'jpg',
      'image/jpg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
      'image/gif': 'gif',
    };
    return typeMap[contentType.toLowerCase()] || 'jpg';
  }

  /**
   * Upload a file to MinIO
   * @param objectName - Full path in the bucket (e.g., "profiles/user123.jpg")
   * @param fileBuffer - File content as Buffer
   * @param options - Upload options (contentType, metadata)
   */
  async uploadFile(
    objectName: string,
    fileBuffer: Buffer,
    options: UploadOptions = {}
  ): Promise<UploadResult> {
    try {
      const { contentType = 'application/octet-stream', metadata = {} } = options;

      // Validate file type if it's an image
      if (contentType.startsWith('image/') && !this.validateFileType(contentType)) {
        throw new Error(
          `Invalid file type: ${contentType}. Allowed types: ${ALLOWED_IMAGE_TYPES.join(', ')}`
        );
      }

      // Upload to MinIO
      const result = await this.client.putObject(
        BUCKET_NAME,
        objectName,
        fileBuffer,
        fileBuffer.length,
        {
          'Content-Type': contentType,
          ...metadata,
        }
      );

      return {
        objectName,
        etag: result.etag,
        ...(result.versionId !== null ? { versionId: result.versionId } : {}),
        objectPath: objectName,
      };
    } catch (error) {
      console.error('Error uploading file to MinIO:', error);
      throw new Error(`Failed to upload file: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Upload profile picture
   * @param userId - User ID
   * @param fileBuffer - Image file buffer
   * @param contentType - Image MIME type
   */
  async uploadProfilePicture(
    userId: string,
    fileBuffer: Buffer,
    contentType: string
  ): Promise<UploadResult> {
    if (fileBuffer.length > MAX_FILE_SIZE.PROFILE) {
      throw new Error(
        `File size exceeds maximum allowed size of ${MAX_FILE_SIZE.PROFILE / (1024 * 1024)} MB`
      );
    }

    const extension = this.getFileExtension(contentType);
    const objectName = `${STORAGE_PATHS.PROFILES}/${userId}.${extension}`;

    return this.uploadFile(objectName, fileBuffer, {
      contentType,
      metadata: {
        'uploaded-by': userId,
        'upload-type': 'profile-picture',
      },
    });
  }

  /**
   * Upload course banner
   * @param courseId - Course ID
   * @param fileBuffer - Image file buffer
   * @param contentType - Image MIME type
   */
  async uploadCourseBanner(
    courseId: string,
    fileBuffer: Buffer,
    contentType: string
  ): Promise<UploadResult> {
    if (fileBuffer.length > MAX_FILE_SIZE.COURSE_BANNER) {
      throw new Error(
        `File size exceeds maximum allowed size of ${MAX_FILE_SIZE.COURSE_BANNER / (1024 * 1024)} MB`
      );
    }

    const extension = this.getFileExtension(contentType);
    const objectName = `${STORAGE_PATHS.COURSES}/${courseId}/banner.${extension}`;

    return this.uploadFile(objectName, fileBuffer, {
      contentType,
      metadata: {
        'course-id': courseId,
        'upload-type': 'course-banner',
      },
    });
  }

  /**
   * Download a file from MinIO
   * @param objectName - Full path in the bucket
   */
  async downloadFile(objectName: string): Promise<Buffer> {
    try {
      const dataStream = await this.client.getObject(BUCKET_NAME, objectName);

      // Convert stream to buffer
      const chunks: Buffer[] = [];
      for await (const chunk of dataStream) {
        chunks.push(Buffer.from(chunk));
      }

      return Buffer.concat(chunks);
    } catch (error) {
      console.error('Error downloading file from MinIO:', error);
      throw new Error(`Failed to download file: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get a presigned URL for file access
   * @param objectName - Full path in the bucket
   * @param expirySeconds - URL expiry time in seconds (default: 7 days)
   */
  async getPresignedUrl(objectName: string, expirySeconds: number = 7 * 24 * 60 * 60): Promise<string> {
    try {
      return await this.client.presignedGetObject(BUCKET_NAME, objectName, expirySeconds);
    } catch (error) {
      console.error('Error generating presigned URL:', error);
      throw new Error(`Failed to generate presigned URL: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get public URL for file (if bucket/object has public access)
   * @param objectName - Full path in the bucket
   */
  async getFileUrl(objectName: string): Promise<string> {
    // For now, return presigned URL. In production with public buckets,
    // you can construct the public URL directly
    return this.getPresignedUrl(objectName);
  }

  /**
   * Delete a file from MinIO
   * @param objectName - Full path in the bucket
   */
  async deleteFile(objectName: string): Promise<void> {
    try {
      await this.client.removeObject(BUCKET_NAME, objectName);
    } catch (error) {
      console.error('Error deleting file from MinIO:', error);
      throw new Error(`Failed to delete file: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Delete profile picture
   * @param userId - User ID
   */
  async deleteProfilePicture(userId: string): Promise<void> {
    // Try deleting all possible extensions
    const extensions = ['jpg', 'png', 'webp', 'gif'];

    for (const ext of extensions) {
      try {
        const objectName = `${STORAGE_PATHS.PROFILES}/${userId}.${ext}`;
        await this.deleteFile(objectName);
      } catch (error) {
        // Ignore errors if file doesn't exist
        continue;
      }
    }
  }

  /**
   * Delete course banner
   * @param courseId - Course ID
   */
  async deleteCourseBanner(courseId: string): Promise<void> {
    // Try deleting all possible extensions
    const extensions = ['jpg', 'png', 'webp', 'gif'];

    for (const ext of extensions) {
      try {
        const objectName = `${STORAGE_PATHS.COURSES}/${courseId}/banner.${ext}`;
        await this.deleteFile(objectName);
      } catch (error) {
        // Ignore errors if file doesn't exist
        continue;
      }
    }
  }

  /**
   * Check if file exists
   * @param objectName - Full path in the bucket
   */
  async fileExists(objectName: string): Promise<boolean> {
    try {
      await this.client.statObject(BUCKET_NAME, objectName);
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * List files in a directory
   * @param prefix - Directory prefix (e.g., "profiles/", "courses/")
   */
  async listFiles(prefix: string): Promise<string[]> {
    try {
      const objectsList: string[] = [];
      const stream = this.client.listObjects(BUCKET_NAME, prefix, true);

      for await (const obj of stream) {
        if (obj.name) {
          objectsList.push(obj.name);
        }
      }

      return objectsList;
    } catch (error) {
      console.error('Error listing files from MinIO:', error);
      throw new Error(`Failed to list files: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get file metadata
   * @param objectName - Full path in the bucket
   */
  async getFileMetadata(objectName: string): Promise<Minio.BucketItemStat> {
    try {
      return await this.client.statObject(BUCKET_NAME, objectName);
    } catch (error) {
      console.error('Error getting file metadata from MinIO:', error);
      throw new Error(`Failed to get file metadata: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}

// Export singleton instance
export const storageService = new StorageService();
