import { Elysia } from "elysia";
import { courseRoutes } from "./courses";
import { authRoutes } from "./auth";
import { aiRoutes } from "./ai";

export const routes = new Elysia()
.group("/v0", (app) => app
    .use(courseRoutes)
    .use(authRoutes) // Moved authRoutes to v0 group for consistency
    .use(aiRoutes) // Ensure aiRoutes is included in the main routes
)