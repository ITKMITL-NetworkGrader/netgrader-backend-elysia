import Elysia from "elysia";
import jwt from "@elysiajs/jwt";
import bearer from "@elysiajs/bearer";
import { env } from "process";
import { JWTPayload } from "..";

export const authPlugin = new Elysia({ name: "authPlugin" })
    .use(bearer())
    .use(
        jwt({
            name: "jwt",
            secret: env.JWT_SECRET || "secret",
        })
    )
    .derive({ as: 'global'}, async ({ jwt, set, path, cookie: { auth_token } })=> {
        console.log(path)
        const excludedPaths = ["/" ,"/swagger", "/swagger/json", "/v0/auth/login", "/v0/auth/register"];
        const dev_env = env.NODE_ENV != "production";
        if (excludedPaths.includes(path) || dev_env) {
            return {};
        }
        if (!auth_token?.value) {
            console.warn("No auth token provided");
            set.status = 401;
            return { error: "Unauthorized - No token provided" };
        }
        try {
            const payload = await jwt.verify(auth_token.value) as JWTPayload | null;
            if (!payload) {
                set.status = 401;
                return { error: "Unauthorized - Invalid token" };
            }
            return { authPlugin : payload };
        } catch (error) {
            console.error("Token verification failed:", error);
            set.status = 401;
            return { error: "Unauthorized - Token verification failed", message: (error as Error).message };
        }
    });