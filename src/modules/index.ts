import { Elysia } from "elysia";
import { courseRoutes } from "./courses";
import { authRoutes } from "./auth";
import { submissionRoutes } from "./submissions";
import { websocket } from "./websocket";
import { aiRoutes } from "./ai";
import { enrollmentRoutes } from "./enrollments";
import { labRoutes } from "./labs";
import { partRoutes } from "./parts";
import { taskTemplateRoutes } from "./task-templates";
import { deviceTemplateRoutes } from "./device-templates";
import { sessionCleanupRoutes } from "./admin/session-cleanup-routes";
import { storageRoutes } from "./storage";
import { gns3Routes } from "./gns3";
import { playgroundRoutes } from "./playground";

export const routes = new Elysia()
    .group("/v0", (app) => app
        .use(websocket)
        .use(courseRoutes)
        .use(authRoutes)
        .use(submissionRoutes)
        .use(enrollmentRoutes)
        .use(aiRoutes)
        .use(labRoutes)
        .use(partRoutes)
        .use(taskTemplateRoutes)
        .use(deviceTemplateRoutes)
        .use(sessionCleanupRoutes)
        .use(storageRoutes)
        .use(gns3Routes)
        .use(playgroundRoutes)
    )