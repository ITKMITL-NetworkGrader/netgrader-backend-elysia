import { createClient } from 'redis';
import { env } from 'process';

const redisClient = createClient({
  url: env.REDIS_URL || 'redis://localhost:6379'
});

redisClient.on('error', (err) => {
  console.error('Redis Client Error', err);
});

export async function connectRedis() {
  try {
    await redisClient.connect();
    console.log('Connected to Redis');
  } catch (error) {
    console.warn('Redis not available, caching disabled:', error.message);
  }
}

export async function disconnectRedis() {
  try {
    await redisClient.disconnect();
    console.log('Disconnected from Redis');
  } catch (error) {
    console.error('Error disconnecting from Redis:', error);
  }
}

/**
 * Cache Service implementing the caching strategy from implementation guide
 */
export class CacheService {

  /**
   * Check if Redis is connected
   */
  private static isRedisConnected(): boolean {
    return redisClient.isOpen;
  }

  /**
   * Task Template Cache (1 hour TTL)
   */
  static async getTaskTemplate(templateId: string) {
    if (!this.isRedisConnected()) return null;
    
    try {
      const key = `task_template:${templateId}`;
      const cached = await redisClient.get(key);
      return cached ? JSON.parse(cached) : null;
    } catch (error) {
      console.error('Error getting task template from cache:', error);
      return null;
    }
  }

  static async setTaskTemplate(templateId: string, template: any) {
    if (!this.isRedisConnected()) return;
    
    try {
      const key = `task_template:${templateId}`;
      await redisClient.setEx(key, 3600, JSON.stringify(template)); // 1 hour TTL
    } catch (error) {
      console.error('Error setting task template cache:', error);
    }
  }

  /**
   * Device Template Cache (1 hour TTL)
   */
  static async getDeviceTemplate(templateId: string) {
    if (!this.isRedisConnected()) return null;
    
    try {
      const key = `device_template:${templateId}`;
      const cached = await redisClient.get(key);
      return cached ? JSON.parse(cached) : null;
    } catch (error) {
      console.error('Error getting device template from cache:', error);
      return null;
    }
  }

  static async setDeviceTemplate(templateId: string, template: any) {
    if (!this.isRedisConnected()) return;
    
    try {
      const key = `device_template:${templateId}`;
      await redisClient.setEx(key, 3600, JSON.stringify(template)); // 1 hour TTL
    } catch (error) {
      console.error('Error setting device template cache:', error);
    }
  }

  /**
   * Student IP Cache (Lab duration TTL)
   */
  static async getStudentIPs(labId: string, studentId: string) {
    if (!this.isRedisConnected()) return null;
    
    try {
      const key = `ips:${labId}:${studentId}`;
      const cached = await redisClient.get(key);
      return cached ? JSON.parse(cached) : null;
    } catch (error) {
      console.error('Error getting student IPs from cache:', error);
      return null;
    }
  }

  static async setStudentIPs(labId: string, studentId: string, ipAssignments: any, ttl: number = 86400) {
    if (!this.isRedisConnected()) return;
    
    try {
      const key = `ips:${labId}:${studentId}`;
      await redisClient.setEx(key, ttl, JSON.stringify(ipAssignments)); // Lab duration TTL
    } catch (error) {
      console.error('Error setting student IPs cache:', error);
    }
  }

  /**
   * Course Permissions Cache (15 minutes TTL)
   */
  static async getCoursePermissions(userId: string, courseId: string) {
    if (!this.isRedisConnected()) return null;
    
    try {
      const key = `perms:${userId}:${courseId}`;
      const cached = await redisClient.get(key);
      return cached ? JSON.parse(cached) : null;
    } catch (error) {
      console.error('Error getting course permissions from cache:', error);
      return null;
    }
  }

  static async setCoursePermissions(userId: string, courseId: string, permissions: any) {
    if (!this.isRedisConnected()) return;
    
    try {
      const key = `perms:${userId}:${courseId}`;
      await redisClient.setEx(key, 900, JSON.stringify(permissions)); // 15 minutes TTL
    } catch (error) {
      console.error('Error setting course permissions cache:', error);
    }
  }

  /**
   * Clear cache by pattern
   */
  static async clearCachePattern(pattern: string) {
    if (!this.isRedisConnected()) return;
    
    try {
      const keys = await redisClient.keys(pattern);
      if (keys.length > 0) {
        await redisClient.del(keys);
      }
    } catch (error) {
      console.error('Error clearing cache pattern:', error);
    }
  }

  /**
   * Clear all cache
   */
  static async clearAllCache() {
    if (!this.isRedisConnected()) return;
    
    try {
      await redisClient.flushAll();
    } catch (error) {
      console.error('Error clearing all cache:', error);
    }
  }
}

export { redisClient };