import { Elysia } from "elysia";
import { courseRoutes } from "./courses";
import { authRoutes } from "./auth";

export const routes = new Elysia()
.group("/v0", (app) => app
    .use(courseRoutes)
)
.group("/auth", (app) => app
    .use(authRoutes)
)