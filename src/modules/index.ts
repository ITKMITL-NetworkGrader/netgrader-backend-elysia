import { Elysia } from "elysia";
import { courseRoutes } from "./courses";
import { authRoutes } from "./auth";
import { gradingRoutes } from "./grading";
import { websocket } from "./websocket";
import { aiRoutes } from "./ai";

export const routes = new Elysia()
.group("/v0", (app) => app
    .use(websocket)
    .use(courseRoutes)
    .use(authRoutes) // Moved authRoutes to v0 group for consistency
)