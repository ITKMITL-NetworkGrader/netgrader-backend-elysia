import { Elysia } from "elysia";
import { swagger } from "@elysiajs/swagger";
import { cors } from "@elysiajs/cors";
import { env } from "process";
import { authPlugin } from "./plugins/plugins.js";
import { routes } from "./modules/index.js";
import { connectDatabase } from "./config/database.js";
import { channel} from "./config/rabbitmq.js";

export type JWTPayload = {
    u_id: string;
    u_role: "ADMIN" | "STUDENT" | "VIEWER";
    iat: number;
    exp: number;
}

declare module 'elysia' {
    interface GlobalContext {
        profile?: JWTPayload;
    }
}
await connectDatabase();
const app = new Elysia()
.use(swagger())
.use(cors())
.use(authPlugin)
.use(routes)
.get("/", () => "Hello Elysia")
  .listen({port : env.PORT || 3000, idleTimeout : 60});

console.log(
  `🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`
);
