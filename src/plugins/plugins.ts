import Elysia from "elysia";
import jwt from "@elysiajs/jwt";
import bearer from "@elysiajs/bearer";
import { env } from "process";
import { JWTPayload } from "..";
import { User } from "../modules/auth/model";

// NG-SEC-010: Fail fast if JWT secret is missing or weak
if (!env.JWT_SECRET || env.JWT_SECRET === "secret" || env.JWT_SECRET.length < 32) {
  console.error("FATAL: JWT_SECRET is missing, weak, or set to default. Set a strong secret (32+ chars).");
  process.exit(1);
}

export const authPlugin = new Elysia({ name: "authPlugin" })
  .use(bearer())
  .use(
    jwt({
      name: "jwt",
      secret: env.JWT_SECRET!,
      exp: '1d'
    })
  )
  .derive({ as: 'global' }, async ({ jwt, set, path, cookie: { auth_token } }) => {
    const publicPaths = ["/", "/health", "/v0/auth/login", "/v0/auth/me", "/swagger", "/swagger/json", "/v0/auth/sso/login", "/v0/auth/sso/callback", "/v0/auth/sso/complete", "/v0/auth/sso/logout"];

    if (publicPaths.includes(path)) {
      return {};
    }

    // D-2/R2-1: Allow worker callback endpoints (exact paths only, authenticated via X-Worker-Secret)
    const workerCallbackPaths = [
      "/v0/submissions/started",
      "/v0/submissions/progress",
      "/v0/submissions/result",
      "/v0/playground/started",
      "/v0/playground/progress",
      "/v0/playground/result"
    ];
    if (workerCallbackPaths.includes(path)) {
      return {};
    }

    if (!auth_token?.value) {
      console.warn("No auth token provided");
      set.status = 401;
      throw new Error("Unauthorized - No auth token provided");
    }
    try {
      const payload = await jwt.verify(auth_token.value) as JWTPayload | null;
      if (!payload) {
        set.status = 401;
        return { error: "Unauthorized - Invalid token" };
      }
      return { authPlugin: payload };
    } catch (error) {
      console.error("Token verification failed:", error);
      set.status = 401;
      throw new Error("Unauthorized - Token verification failed");
    }
  });

export function requireRole(allowedRoles: string[]) {
  return async ({ set, authPlugin }: { set: any, authPlugin?: any }) => {
    try {
      if (!authPlugin?.u_id) {
        set.status = 401;
        return { error: "Unauthorized - No user ID found" };
      }

      const user = await User.findOne({ u_id: authPlugin.u_id }, "role");
      if (!user) {
        set.status = 401;
        return { error: "Unauthorized - User not found" };
      }

      if (!allowedRoles.includes(user.role)) {
        set.status = 403;
        return { error: "Forbidden: insufficient role" };
      }

      // If all checks pass, don't return anything to continue to the main handler
    } catch (error) {
      console.error("Role check error:", error);
      set.status = 500;
      return { error: "Internal server error" };
    }
  };
}