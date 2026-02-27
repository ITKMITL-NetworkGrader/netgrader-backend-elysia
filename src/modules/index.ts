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
import { gns3SyncRoutes } from "./admin/gns3-sync-routes";
import { storageRoutes } from "./storage";
import { gns3Routes } from "./gns3";
import { gns3StudentLabRoutes } from "./gns3-student-lab";
import { playgroundRoutes } from "./playground";
import { profileRoutes } from "./profile";
import { geminiRoutes } from "./gemini";
import { geminiChatRoutes } from "./gemini-chat";
import { taskGeneratorRoutes } from "./task-generator";

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
        .use(gns3SyncRoutes)
        .use(storageRoutes)
        .use(gns3Routes)
        .use(gns3StudentLabRoutes)
        .use(playgroundRoutes)
        .use(profileRoutes)
        .use(geminiRoutes)
        .use(geminiChatRoutes)
        .use(taskGeneratorRoutes)
    )