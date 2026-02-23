import { Elysia } from "elysia";
import { swagger } from "@elysiajs/swagger";
import { cors } from "@elysiajs/cors";
import { env } from "process";
import { authPlugin } from "./plugins/plugins.js";
import { routes } from "./modules/index.js";
import { connectDatabase } from "./config/database.js";
import { connectRedis, gracefulShutdown } from "./config/redis.js";
import { initializeMinioBucket } from "./config/minio.js";
import { LabSessionCleanupService } from "./services/lab-session-cleanup.js";
import { enableGlobalTimestamps } from "./utils/logger.js";
import { OpenAPIService } from "./services/openapi-service.js";

// Enable timestamps on all console.log/warn/error calls
enableGlobalTimestamps();

export type JWTPayload = {
  u_id: string;
  fullName?: string;
  role: string;
  iat: number;
  exp: number;
}

declare module 'elysia' {
  interface GlobalContext {
    profile?: JWTPayload;
  }
}
await connectDatabase();
// await connectRedis();

// Initialize MinIO (optional - will log error but not crash if unavailable)
try {
  await initializeMinioBucket();
} catch (error) {
  console.warn('⚠️  MinIO initialization failed. Storage features will not be available.');
}

const app = new Elysia()
  .use(swagger({
    documentation: {
      info: {
        title: "NetGrader API Swagger EIEI",
        version: "1.0.0",
        description: "NetGrader API Documentation",
      },
    },
  }))
  .use(cors({
    origin: env.FRONTEND_ORIGIN,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
    allowedHeaders: ["Content-Type", "ACCEPT", "Authorization"],
    credentials: true,
  }))
  .use(authPlugin)
  .use(routes)
  // .onStart(async (app) => {
  //   try {
  //     const response = await app.handle(
  //       new Request('http://localhost:4000/swagger/json')
  //     )
  //     if (response.ok) {
  //       const spec = await response.text()
  //       await Bun.write('openapi.json', spec)
  //       console.log('✅ OpenAPI spec updated: openapi.json')
  //     }
  //   } catch (error) {
  //     console.error('❌ Failed to export OpenAPI spec:', error)
  //   }
  // })
  .onStart(async (app) => {
    await OpenAPIService.generateYAML(app);
  })
  .get("/", () => "Hello Elysia")
  .listen({ port: env.PORT || 3000, idleTimeout: 60 });

console.log(
  `🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`
);

// ============================================================================
// Scheduled Tasks: Lab Session Cleanup
// ============================================================================

/**
 * Cleanup expired lab sessions (releases IPs when labs timeout)
 * Runs every hour
 */
const CLEANUP_INTERVAL = 60 * 60 * 1000; // 1 hour

const cleanupInterval = setInterval(async () => {
  try {
    const result = await LabSessionCleanupService.cleanupExpiredLabSessions();
    if (result.released > 0) {
      console.log(`[Scheduler] Cleanup completed: ${result.released} IPs released from expired labs`);
      result.details.forEach(detail => {
        console.log(`  - Student ${detail.studentId}: IP ${detail.ip} released (${detail.reason})`);
      });
    }
  } catch (error) {
    console.error('[Scheduler] Lab session cleanup failed:', error);
  }
}, CLEANUP_INTERVAL);

/**
 * Housekeeping: Delete very old completed sessions (runs daily)
 */
const HOUSEKEEPING_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours

const housekeepingInterval = setInterval(async () => {
  try {
    const result = await LabSessionCleanupService.cleanupOldCompletedSessions(90);
    if (result.deleted > 0) {
      console.log(`[Scheduler] ${result.message}`);
    }
  } catch (error) {
    console.error('[Scheduler] Housekeeping cleanup failed:', error);
  }
}, HOUSEKEEPING_INTERVAL);

console.log(`✅ Scheduled tasks initialized:`);
console.log(`   - Lab session cleanup: Every ${CLEANUP_INTERVAL / 60000} minutes`);
console.log(`   - Housekeeping: Every ${HOUSEKEEPING_INTERVAL / 3600000} hours`);

// ============================================================================
// Graceful Shutdown
// ============================================================================

// Graceful shutdown handling
// process.on('SIGINT', async () => {
//   console.log('\n🛑 Received SIGINT, shutting down gracefully...');
//   clearInterval(cleanupInterval);
//   clearInterval(housekeepingInterval);
//   await gracefulShutdown();
//   process.exit(0);
// });

// process.on('SIGTERM', async () => {
//   console.log('\n🛑 Received SIGTERM, shutting down gracefully...');
//   clearInterval(cleanupInterval);
//   clearInterval(housekeepingInterval);
//   await gracefulShutdown();
//   process.exit(0);
// });
