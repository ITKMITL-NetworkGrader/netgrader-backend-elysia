import * as Minio from 'minio';
import { env } from 'process';

/**
 * MinIO Client Configuration
 * Manages connection to MinIO object storage
 */

let minioClient: Minio.Client | null = null;

export const BUCKET_NAME = env.MINIO_BUCKET_NAME || 'netgrader-assets';

/**
 * Initialize MinIO client
 */
export function getMinioClient(): Minio.Client {
  if (!minioClient) {
    const endPoint = env.MINIO_ENDPOINT || 'localhost';
    const port = parseInt(env.MINIO_PORT || '9000');
    const useSSL = env.MINIO_USE_SSL === 'true';
    const accessKey = env.MINIO_ACCESS_KEY;
    const secretKey = env.MINIO_SECRET_KEY;

    if (!accessKey || !secretKey) {
      throw new Error('MinIO credentials not configured. Please set MINIO_ACCESS_KEY and MINIO_SECRET_KEY in environment variables.');
    }

    minioClient = new Minio.Client({
      endPoint,
      port,
      useSSL,
      accessKey,
      secretKey,
    });

    console.log(`MinIO client initialized: ${endPoint}:${port} (SSL: ${useSSL})`);
  }

  return minioClient;
}

/**
 * Initialize MinIO bucket
 * Creates the bucket if it doesn't exist and sets up policies
 */
export async function initializeMinioBucket(): Promise<void> {
  try {
    const client = getMinioClient();
    const bucketExists = await client.bucketExists(BUCKET_NAME);

    if (!bucketExists) {
      await client.makeBucket(BUCKET_NAME, 'us-east-1');
      console.log(`✅ MinIO bucket '${BUCKET_NAME}' created successfully`);

      // Set bucket policy for public read access to course banners (if needed)
      // You can customize this based on your access requirements
      const publicReadPolicy = {
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Principal: { AWS: ['*'] },
            Action: ['s3:GetObject'],
            Resource: [`arn:aws:s3:::${BUCKET_NAME}/courses/*`],
          },
        ],
      };

      // Uncomment if you want course banners to be publicly accessible
      // await client.setBucketPolicy(BUCKET_NAME, JSON.stringify(publicReadPolicy));
      // console.log(`✅ MinIO bucket policy set for public course banners`);
    } else {
      console.log(`✅ MinIO bucket '${BUCKET_NAME}' already exists`);
    }
  } catch (error) {
    console.error('❌ Failed to initialize MinIO bucket:', error);
    throw error;
  }
}

/**
 * Test MinIO connection
 */
export async function testMinioConnection(): Promise<boolean> {
  try {
    const client = getMinioClient();
    await client.listBuckets();
    console.log('✅ MinIO connection test successful');
    return true;
  } catch (error) {
    console.error('❌ MinIO connection test failed:', error);
    return false;
  }
}

/**
 * Graceful shutdown for MinIO (cleanup if needed)
 */
export async function closeMinioConnection(): Promise<void> {
  // MinIO client doesn't require explicit connection closing
  // but we can reset the client instance
  minioClient = null;
  console.log('MinIO client connection closed');
}
