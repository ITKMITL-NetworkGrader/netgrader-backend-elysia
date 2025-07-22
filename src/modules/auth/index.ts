import { Elysia, t } from "elysia";
import jwt from "@elysiajs/jwt";
import { env } from "process";
import { AuthService } from "./service";
import { JWTPayload } from "../../index";
import { Types } from "mongoose";
import { User } from "./model";
import bearer from "@elysiajs/bearer";
import { authPlugin } from "../../plugins/plugins";

const UserSchema = t.Object({
  u_id: t.String({ minLength: 1 }),
  password: t.String({ minLength: 1 }),
  fullName: t.String({ minLength: 1 }),
  role: t.Union([
    t.Literal("ADMIN"),
    t.Literal("STUDENT"),
    t.Literal("VIEWER"),
  ]),
  //ldapAuthenticated: t.Boolean({ default: false }),
  //lastLogin: t.Optional(t.Date()),
});

export const authRoutes = new Elysia({ prefix: "/auth" })
  .use(authPlugin)
  .use(
    jwt({
      name: "jwt",
      secret: env.JWT_SECRET || "secret",
    })
  )
  .post(
    "/login",
    async ({ body, jwt, set, cookie : { auth_token } }) => {
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
        fullName: authResult.user.fullName,
        u_role: authResult.user.role,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 24 * 60 * 60, // 24 hours
      };

      const token = await jwt.sign(payload);
      auth_token.value = token
      auth_token.httpOnly = true;
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
  //-------------------------------------------------------------------------------------------------------
  .post(
    "/register", 
      async ({ body, set }) => {
        try {
            const { u_id, password, fullName, role } = body;
            const userData = new User({u_id, password, fullName, role, ldapAuthenticated: false , lastLogin: new Date()});
            const createdUserResult = await AuthService.createUser(userData);
            if (!createdUserResult) {
              set.status = 400;
              return { success: false, message: "User already exists" };
            }
            set.status = 200;
            return { 
              success: true, 
              user: createdUserResult.u_id,
              role: createdUserResult.role,
              message: "User registered successfully" 
        };
        }
        catch (error: any) {
          set.status = 400;
          return { success: false, message: error.message || "Error registering user" };
        }
    },
    {
      body: UserSchema,
      response: {
        200: t.Object({
          success: t.Boolean(),
          message: t.String(),
          user: t.String(),
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
        summary: "User Registration",
        description:
          "Register a new user with username, password, full name, and role. If the user already exists, it will return an error.",
      },
    }
  )
  //-------------------------------------------------------------------------------------------------------
  .post("/logout", async ({ set, cookie: { auth_token } }) => {
    auth_token.remove();
    auth_token.httpOnly = true;
    set.status = 200;
    return { success: true, message: "Logged out successfully" };
  }, {
    detail: {
      tags: ["Authentication"],
      summary: "User Logout",
      description: "Logout the user by clearing the authentication token.",
    },
  })
  .get(
    "/me",
    async ({ set, authPlugin }) => {
      set.status = 200;
      return authPlugin;
    },
    {
      detail: {
        tags: ["Authentication"],
        summary: "Get User Profile",
        description: "Retrieve the authenticated user's profile information.",
      },
    }
  );
