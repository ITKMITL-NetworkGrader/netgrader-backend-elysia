import { Elysia } from "elysia";
import jwt from "@elysiajs/jwt";
import { env } from "process";
import { AuthentikAuth, type AuthentikUser } from "../../../lib/authentik";

// ─── Authentik OIDC Configuration ────────────────────────────────────────────

const auth = new AuthentikAuth({
  issuer: process.env.AUTHENTIK_ISSUER!,
  clientId: process.env.OIDC_CLIENT_ID!,
  clientSecret: process.env.OIDC_CLIENT_SECRET!,
  redirectUri: process.env.OIDC_REDIRECT_URI!,
  sessionSecret: process.env.SESSION_SECRET!,
  basePath: process.env.OIDC_BASE_PATH ?? "/sso",
  postLoginRedirect: "/v0/auth/sso/complete",
  postLogoutRedirect: "/v0/auth/sso/signout",
  // allowHttp: process.env.NODE_ENV !== "production",
});

// ─── Role Mapping ────────────────────────────────────────────────────────────

function mapGroupsToRole(groups: string[]): string {
  const lower = groups.map((g) => g.toLowerCase());
  if (lower.some((g) => g.includes("admin"))) return "ADMIN";
  if (lower.some((g) => g.includes("instructor"))) return "INSTRUCTOR";
  return "STUDENT";
}

// ─── SSO Routes ──────────────────────────────────────────────────────────────

export const ssoRoutes = new Elysia()
  .use(auth.plugin())
  .use(
    jwt({
      name: "jwt",
      secret: env.JWT_SECRET || "secret",
      exp: "1d",
    })
  )
  .get("/sso/complete", async ({ user, jwt, cookie: { auth_token }, redirect, set }) => {
    const ssoUser = user as AuthentikUser | null;

    if (!ssoUser) {
      set.status = 401;
      return { success: false, message: "SSO authentication failed — no user session." };
    }

    const role = mapGroupsToRole(ssoUser.groups);

    const payload = {
      u_id: ssoUser.preferred_username || ssoUser.sub,
      fullName: ssoUser.name,
      role,
    };

    const token = await jwt.sign(payload);

    auth_token.value = token;
    auth_token.httpOnly = true;

    const frontendUrl = env.FRONTEND_ORIGIN || "/";
    return redirect(frontendUrl);
  })
  .get("/sso/signout", async ({ cookie: { auth_token }, redirect }) => {
    // Clear the app's JWT cookie, then redirect to the plugin's logout route
    // which clears the Authentik session and redirects to Authentik's end_session_endpoint
    auth_token.remove();
    const frontendUrl = env.FRONTEND_ORIGIN || "/";
    return redirect(frontendUrl);
  });
