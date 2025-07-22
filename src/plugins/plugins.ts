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
    .derive({ as: 'global'}, async ({ bearer, jwt, set, path, cookie: { auth_token } })=> {
        console.log(path)
        const profile = await jwt.verify(auth_token.value) as JWTPayload | null;
        const excludedPaths = ["/" ,"/swagger", "/swagger/json", "/v0/auth/login", "/v0/auth/register"];
        const dev_env = env.NODE_ENV != "production" && !bearer;
        if (excludedPaths.includes(path) || dev_env) {
            return {};
        } else if (!profile) {
            set.status = 401;
            throw new Error("Unauthorized");
        }
        set.status = 200;
        return { authPlugin: profile };
    });