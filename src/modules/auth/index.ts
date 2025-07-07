import { Elysia, t } from "elysia";
import jwt from "@elysiajs/jwt";
import { env } from "process";
import { AuthService } from "./service";
import { JWTPayload } from "../../index";
import { Types } from "mongoose";

export const authRoutes = new Elysia({ prefix: "/auth" })
  .use(
    jwt({
      name: "jwt",
      secret: env.JWT_SECRET || "secret",
    })
  )
  .post(
    "/login",
    async ({ body, jwt, set }) => {
      const { username, password } = body;

      if (!username || !password) {
        set.status = 400;
        return {
          success: false,
          message: "Username and password are required",
        };
      }

      const authResult = await AuthService.authenticateUser(username, password);

      if (!authResult.success || !authResult.user) {
        set.status = 401;
        return {
          success: false,
          message: authResult.message || "Authentication failed",
        };
      }

      // Create JWT token
      const payload: JWTPayload = {
        u_id: authResult.user.u_id,
        u_role: authResult.user.role,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 24 * 60 * 60, // 24 hours
      };

      const token = await jwt.sign(payload);

      set.status = 200;
      return {
        success: true,
        message: authResult.message || "Authentication successful",
        isFirstTimeLogin: authResult.isFirstTimeLogin,
        token,
        user: {
          id: (authResult.user._id as Types.ObjectId).toString(),
          u_id: authResult.user.u_id,
          fullName: authResult.user.fullName,
          role: authResult.user.role,
          lastLogin: authResult.user.lastLogin,
        },
      };
    },
    {
      body: t.Object({
        username: t.String({ minLength: 1 }),
        password: t.String({ minLength: 1 }),
      }),
      response: {
        200: t.Object({
          success: t.Boolean(),
          message: t.String(),
          isFirstTimeLogin: t.Optional(t.Boolean()),
          token: t.Optional(t.String()),
          user: t.Optional(
            t.Object({
              id: t.String(),
              u_id: t.String(),
              fullName: t.String(),
              role: t.Union([
                t.Literal("ADMIN"),
                t.Literal("STUDENT"),
                t.Literal("VIEWER"),
              ]),
              lastLogin: t.Date(),
            })
          ),
        }),
        400: t.Object({
          success: t.Boolean(),
          message: t.String(),
        }),
        401: t.Object({
          success: t.Boolean(),
          message: t.String(),
        }),
      },
      detail: {
        tags: ["Authentication"],
        summary: "User Login",
        description:
          "Authenticate user with username and password. Checks MongoDB first, then LDAP for new users.",
      },
    }
  )
  .get(
    "/profile",
    async ({ profile, set }) => {
        let user_profile = await AuthService.getUserByUsername(profile?.u_id); 
        return user_profile?.toJSON()
    },
    {
      detail: {
        tags: ["Authentication"],
        summary: "Get User Profile",
        description: "Retrieve the authenticated user's profile information.",
      },
    }
  );
