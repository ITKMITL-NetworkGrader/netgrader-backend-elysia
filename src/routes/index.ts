import { Elysia } from "elysia";
import { courseRoutes } from "./courses";

export const routes = new Elysia()
.group("/v0", (app) => app
    .use(courseRoutes)
)