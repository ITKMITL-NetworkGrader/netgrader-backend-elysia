import { Elysia } from "elysia";
import { courseRoutes } from "./courses";
import { authRoutes } from "./auth";
import { enrollmentRoutes } from "./enrollments";

export const routes = new Elysia()
.group("/v0", (app) => app
    .use(courseRoutes)
    .use(authRoutes)
    .use(enrollmentRoutes)
)