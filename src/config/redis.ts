import { createClient, RedisClientType } from 'redis';
import { env } from 'process';

// Enhanced Redis client configuration with retry logic and connection pooling
const redisClient: RedisClientType = createClient({
  url: env.REDIS_URL || 'redis://localhost:6379',
  socket: {
    connectTimeout: 10000,        // 10 seconds connection timeout
    reconnectStrategy: (retries) => {
      if (retries > 10) {
        console.error('Redis: Max reconnection attempts reached');
        return false; // Stop trying to reconnect
      }
      const delay = Math.min(retries * 100, 3000); // Exponential backoff, max 3 seconds
      console.log(`Redis: Reconnecting in ${delay}ms (attempt ${retries})`);
      return delay;
    },
  },
});

// Enhanced error handling
redisClient.on('error', (err) => {
  console.error('Redis Client Error:', err.message);
  // Don't crash the app on Redis errors, just log them
});

redisClient.on('connect', () => {
  console.log('Redis: Connecting...');
});

redisClient.on('ready', () => {
  console.log('Redis: Connected and ready');
});

redisClient.on('reconnecting', () => {
  console.log('Redis: Reconnecting...');
});

redisClient.on('end', () => {
  console.log('Redis: Connection ended');
});

export async function connectRedis() {
  try {
    if (!redisClient.isOpen) {
      await redisClient.connect();
      console.log('Redis: Successfully connected');
    }
  } catch (error) {
    console.warn('Redis: Connection failed, caching disabled:', (error as Error).message);
    // Don't throw error, let the app continue without Redis
  }
}

export async function disconnectRedis() {
  try {
    if (redisClient.isOpen) {
      await redisClient.disconnect();
      console.log('Redis: Successfully disconnected');
    }
  } catch (error) {
    console.error('Redis: Error during disconnect:', (error as Error).message);
  }
}

// Graceful shutdown handler
export async function gracefulShutdown() {
  console.log('Redis: Initiating graceful shutdown...');
  await disconnectRedis();
}

/**
 * Cache Service implementing the caching strategy from implementation guide
 */
export class CacheService {

  /**
   * Check if Redis is connected and ready
   */
  private static isRedisConnected(): boolean {
    return redisClient.isOpen && redisClient.isReady;
  }

  /**
   * Safe Redis operation wrapper with error handling
   */
  private static async safeRedisOperation<T>(
    operation: () => Promise<T>,
    fallback: T | null = null
  ): Promise<T | null> {
    if (!this.isRedisConnected()) {
      return fallback;
    }

    try {
      return await operation();
    } catch (error) {
      console.error('Redis operation failed:', (error as Error).message);
      return fallback;
    }
  }

  /**
   * Task Template Cache (1 hour TTL)
   */
  static async getTaskTemplate(templateId: string) {
    return this.safeRedisOperation(async () => {
      const key = `task_template:${templateId}`;
      const cached = await redisClient.get(key);
      return cached ? JSON.parse(cached) : null;
    });
  }

  static async setTaskTemplate(templateId: string, template: any) {
    await this.safeRedisOperation(async () => {
      const key = `task_template:${templateId}`;
      await redisClient.setEx(key, 3600, JSON.stringify(template)); // 1 hour TTL
    });
  }

  /**
   * Device Template Cache (1 hour TTL)
   */
  static async getDeviceTemplate(templateId: string) {
    return this.safeRedisOperation(async () => {
      const key = `device_template:${templateId}`;
      const cached = await redisClient.get(key);
      return cached ? JSON.parse(cached) : null;
    });
  }

  static async setDeviceTemplate(templateId: string, template: any) {
    await this.safeRedisOperation(async () => {
      const key = `device_template:${templateId}`;
      await redisClient.setEx(key, 3600, JSON.stringify(template)); // 1 hour TTL
    });
  }

  /**
   * Student IP Cache (Lab duration TTL)
   */
  static async getStudentIPs(labId: string, studentId: string) {
    return this.safeRedisOperation(async () => {
      const key = `ips:${labId}:${studentId}`;
      const cached = await redisClient.get(key);
      return cached ? JSON.parse(cached) : null;
    });
  }

  static async setStudentIPs(labId: string, studentId: string, ipAssignments: any, ttl: number = 86400) {
    await this.safeRedisOperation(async () => {
      const key = `ips:${labId}:${studentId}`;
      await redisClient.setEx(key, ttl, JSON.stringify(ipAssignments)); // Lab duration TTL
    });
  }

  /**
   * Course Permissions Cache (15 minutes TTL)
   */
  static async getCoursePermissions(userId: string, courseId: string) {
    return this.safeRedisOperation(async () => {
      const key = `perms:${userId}:${courseId}`;
      const cached = await redisClient.get(key);
      return cached ? JSON.parse(cached) : null;
    });
  }

  static async setCoursePermissions(userId: string, courseId: string, permissions: any) {
    await this.safeRedisOperation(async () => {
      const key = `perms:${userId}:${courseId}`;
      await redisClient.setEx(key, 900, JSON.stringify(permissions)); // 15 minutes TTL
    });
  }

  /**
   * Clear cache by pattern
   */
  static async clearCachePattern(pattern: string) {
    await this.safeRedisOperation(async () => {
      const keys = await redisClient.keys(pattern);
      if (keys.length > 0) {
        await redisClient.del(keys);
      }
    });
  }

  /**
   * Clear all cache
   */
  static async clearAllCache() {
    await this.safeRedisOperation(async () => {
      await redisClient.flushAll();
    });
  }
}

export { redisClient };