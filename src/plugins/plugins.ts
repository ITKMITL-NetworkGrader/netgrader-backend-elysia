import Elysia from "elysia";
import jwt from "@elysiajs/jwt";
import bearer from "@elysiajs/bearer";
import { env } from "process";
import { JWTPayload } from "..";

export const authPlugin = new Elysia()
    .use(bearer())
    .use(
        jwt({
            name: "jwt",
            secret: env.JWT_SECRET || "secret",
        })
    )
    .derive(async ({ bearer, jwt, set, path }): Promise<{ profile?: JWTPayload }> => {
        const profile = await jwt.verify(bearer) as JWTPayload | null;
        const excludedPaths = ["/" ,"/swagger", "/swagger/json"];
        const dev_env = env.NODE_ENV != "production" && !bearer;
        if (excludedPaths.includes(path) || dev_env) {
            return {};
        } else if (!profile) {
            set.status = 401;
            throw new Error("Unauthorized");
        }
        set.status = 200;
        return {
            profile,
        };
    })
    .as('global');