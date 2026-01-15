import { Elysia, t } from "elysia";
import jwt from "@elysiajs/jwt";
import { env } from "process";
import { AuthService } from "./service";
import { JWTPayload } from "../../index";
import { Types } from "mongoose";
import { User } from "./model";
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
      exp: '1d',
    })
  )
  .post(
    "/login",
    async ({ body, jwt, set, cookie: { auth_token } }) => {
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
        role: authResult.user.role,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 24 * 60 * 60, // 24 hours
      };

      const value = await jwt.sign(payload);
      auth_token.value = value;
      auth_token.httpOnly = true;
      set.status = 200;
      return {
        success: true,
        message: authResult.message || "Authentication successful",
        isFirstTimeLogin: authResult.isFirstTimeLogin,
        value,
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
              role: t.String(),
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
        const userData = new User({
          u_id,
          password,
          fullName,
          role,
          ldapAuthenticated: false,
          lastLogin: new Date(),
        });
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
          message: "User registered successfully",
        };
      } catch (error: any) {
        set.status = 400;
        return {
          success: false,
          message: error.message || "Error registering user",
        };
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
  .post(
    "/logout",
    async ({ set, cookie: { auth_token } }) => {
      auth_token.remove();
      auth_token.httpOnly = true;
      set.status = 200;
      return { success: true, message: "Logged out successfully" };
    },
    {
      detail: {
        tags: ["Authentication"],
        summary: "User Logout",
        description: "Logout the user by clearing the authentication token.",
      },
    }
  )
  .get(
    "/me",
    async ({ jwt, status, cookie: { auth_token } }) => {
      console.log(auth_token.value)
      const profile = await jwt.verify(auth_token.value);
      if (!profile) {
        status(401, 'Unauthorized');
      }
      return profile;
    },
    {
      detail: {
        tags: ["Authentication"],
        summary: "Get User Profile",
        description: "Retrieve the authenticated user's profile information.",
      },
    }
  )
  .get(
    "/role",
    async ({ set, authPlugin }) => {
      const { u_id } = authPlugin ?? { u_id: "" };
      const data = await User.findOne({ u_id }).select({ role: 1, _id: 0, password: 0 });
      if (!data) {
        set.status = 404;
        return { success: false, message: "User not found" };
      }
      set.status = 200;
      return {
        success: true,
        data: data?.role
      };
    },
    {
      detail: {
        tags: ["Authentication"],
        summary: "Get User Role",
        description: "Retrieve the authenticated user's role.",
      },
    }
  )
  //-------------------------------------------------------------------------------------------------------
  // DEV ONLY - Surrogate Login
  //-------------------------------------------------------------------------------------------------------
  .post(
    "/surrogate",
    async ({ body, jwt, set, cookie: { auth_token } }) => {
      // Only allow in development environment
      if (env.NODE_ENV === "production") {
        set.status = 403;
        return {
          success: false,
          message: "Surrogate login is only available in development environment",
        };
      }

      const { username } = body;

      if (!username) {
        set.status = 400;
        return {
          success: false,
          message: "Username is required",
        };
      }

      const user = await AuthService.getUserByUsername(username);

      if (!user) {
        set.status = 404;
        return {
          success: false,
          message: "User not found",
        };
      }

      // Create JWT token (same format as regular login)
      const payload: JWTPayload = {
        u_id: user.u_id,
        fullName: user.fullName,
        role: user.role,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 24 * 60 * 60, // 24 hours
      };

      const value = await jwt.sign(payload);
      auth_token.value = value;
      auth_token.httpOnly = true;
      set.status = 200;

      console.log(`[DEV] Surrogate login for user: ${user.u_id}`);

      return {
        success: true,
        message: "Surrogate login successful (DEV ONLY)",
        value,
        user: {
          id: (user._id as Types.ObjectId).toString(),
          u_id: user.u_id,
          fullName: user.fullName,
          role: user.role,
          lastLogin: user.lastLogin,
        },
      };
    },
    {
      body: t.Object({
        username: t.String({ minLength: 1 }),
      }),
      response: {
        200: t.Object({
          success: t.Boolean(),
          message: t.String(),
          value: t.Optional(t.String()),
          user: t.Optional(
            t.Object({
              id: t.String(),
              u_id: t.String(),
              fullName: t.String(),
              role: t.String(),
              lastLogin: t.Date(),
            })
          ),
        }),
        400: t.Object({
          success: t.Boolean(),
          message: t.String(),
        }),
        403: t.Object({
          success: t.Boolean(),
          message: t.String(),
        }),
        404: t.Object({
          success: t.Boolean(),
          message: t.String(),
        }),
      },
      detail: {
        tags: ["Authentication"],
        summary: "Surrogate Login (DEV ONLY)",
        description:
          "Login as any user by username without password. Only available in development environment. Returns 403 in production.",
      },
    }
  );
