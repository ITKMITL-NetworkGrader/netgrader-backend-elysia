/**
 * Docker Module - Routes for managing Docker images
 *
 * Provides endpoints to build, pull, list, and remove Docker images
 * for use in ContainerLab topologies.
 */

import { Elysia, t } from "elysia";
import {
    buildImage,
    imageExists,
    listImages,
    pullImage,
    removeImage,
    testConnection,
} from "./client";
import { authPlugin, requireRole } from "../../plugins/plugins";

export const dockerRoutes = new Elysia({ prefix: "/docker" })
    .use(authPlugin)
    .get(
        "/test",
        async ({ set }) => {
            const result = await testConnection();

            if (!result.success) {
                set.status = 500;
            }

            return result;
        },
        {
            beforeHandle: requireRole(["ADMIN"]),
            detail: {
                tags: ["Docker"],
                summary: "Test Docker connection",
                description: "Verify Docker daemon is accessible",
            },
        },
    )
    /**
     * GET /docker/images
     * List all Docker images
     */
    .get(
        "/images",
        async ({ set }) => {
            const result = await listImages();

            if (!result.success) {
                set.status = 500;
            }

            return result;
        },
        {
            beforeHandle: requireRole(["ADMIN", "INSTRUCTOR"]),
            detail: {
                tags: ["Docker"],
                summary: "List Docker images",
                description: "Get all locally available Docker images",
            },
        },
    )
    /**
     * POST /docker/images/pull
     * Pull a Docker image from registry
     */
    .post(
        "/images/pull",
        async ({ body, set }) => {
            const { imageName, tag } = body as { imageName: string; tag?: string };
            const result = await pullImage({ imageName, tag });

            if (!result.success) {
                set.status = 500;
            }

            return result;
        },
        {
            body: t.Object({
                imageName: t.String({ minLength: 1 }),
                tag: t.Optional(t.String()),
            }),
            beforeHandle: requireRole(["ADMIN"]),
            detail: {
                tags: ["Docker"],
                summary: "Pull Docker image",
                description: "Pull an image from a Docker registry",
            },
        },
    )
    /**
     * POST /docker/images/build
     * Build a Docker image from Dockerfile
     */
    .post(
        "/images/build",
        async ({ body, set }) => {
            const { dockerfile, tag, context, buildArgs } = body as {
                dockerfile: string;
                tag: string;
                context?: string;
                buildArgs?: Record<string, string>;
            };

            const result = await buildImage({
                dockerfile,
                tag,
                context,
                buildArgs,
            });

            if (!result.success) {
                set.status = 500;
            }

            return result;
        },
        {
            body: t.Object({
                dockerfile: t.String({ minLength: 1 }),
                tag: t.String({ minLength: 1 }),
                context: t.Optional(t.String()),
                buildArgs: t.Optional(t.Record(t.String(), t.String())),
            }),
            beforeHandle: requireRole(["ADMIN"]),
            detail: {
                tags: ["Docker"],
                summary: "Build Docker image",
                description: "Build an image from a Dockerfile",
            },
        },
    )
    /**
     * DELETE /docker/images/:imageName
     * Remove a Docker image
     */
    .delete(
        "/images/:imageName",
        async ({ params, set }) => {
            const result = await removeImage(params.imageName);

            if (!result.success) {
                set.status = 500;
            }

            return result;
        },
        {
            params: t.Object({
                imageName: t.String({ minLength: 1 }),
            }),
            beforeHandle: requireRole(["ADMIN"]),
            detail: {
                tags: ["Docker"],
                summary: "Remove Docker image",
                description: "Delete a local Docker image",
            },
        },
    )
    /**
     * GET /docker/images/:imageName/exists
     * Check if image exists locally
     */
    .get(
        "/images/:imageName/exists",
        async ({ params }) => {
            const exists = await imageExists(params.imageName);

            return { exists };
        },
        {
            params: t.Object({
                imageName: t.String({ minLength: 1 }),
            }),
            beforeHandle: requireRole(["ADMIN", "INSTRUCTOR"]),
            detail: {
                tags: ["Docker"],
                summary: "Check if image exists",
                description: "Check if a Docker image exists locally",
            },
        },
    );

export default dockerRoutes;
