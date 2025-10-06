import { Elysia } from "elysia";
import { swagger } from "@elysiajs/swagger";
import { cors } from "@elysiajs/cors";
import { env } from "process";
import { authPlugin } from "./plugins/plugins.js";
import { routes } from "./modules/index.js";
import { connectDatabase } from "./config/database.js";
import { connectRedis, gracefulShutdown } from "./config/redis.js";

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
const app = new Elysia()
.use(swagger())
.use(cors({
  origin: env.FRONTEND_ORIGIN,
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
  allowedHeaders: ["Content-Type", "ACCEPT", "Authorization"],
  credentials: true,
}))
.use(authPlugin)
.use(routes)
.get("/", () => "Hello Elysia")
  .listen({port : env.PORT || 3000, idleTimeout : 60});

console.log(
  `🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`
);

// Graceful shutdown handling
// process.on('SIGINT', async () => {
//   console.log('\n🛑 Received SIGINT, shutting down gracefully...');
//   await gracefulShutdown();
//   process.exit(0);
// });

// process.on('SIGTERM', async () => {
//   console.log('\n🛑 Received SIGTERM, shutting down gracefully...');
//   await gracefulShutdown();
//   process.exit(0);
// });
