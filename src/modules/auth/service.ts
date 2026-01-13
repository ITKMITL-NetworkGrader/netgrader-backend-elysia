import { authenticate } from "ldap-authentication";
import { User, IUser } from "./model";
import { env } from "process";
import { getDateWithTimezone } from "../../utils/helpers.js";
import { get } from "mongoose";
import { GNS3v3Service } from "../gns3-student-lab/service";


export interface LDAPConfig {
  ldapOpts: {
    url: string;
  };
  adminDn: string;
  adminPassword: string;
  userPassword: string;
  userSearchBase: string;
  usernameAttribute: string;
  username: string;
  attributes: string[];
}

export interface AuthResult {
  success: boolean;
  user?: IUser;
  token?: string;
  message?: string;
  isFirstTimeLogin?: boolean;
}

export class AuthService {
  private static getLDAPConfig(username: string, password: string): LDAPConfig {
    return {
      ldapOpts: {
        url: env.LDAP_URL || "ldap://localhost:389",
      },
      adminDn: env.LDAP_ADMIN_DN || "cn=admin,dc=example,dc=com",
      adminPassword: env.LDAP_ADMIN_PASSWORD || "admin",
      userPassword: password,
      userSearchBase: env.LDAP_USER_SEARCH_BASE || "ou=users,dc=example,dc=com",
      usernameAttribute: env.LDAP_USERNAME_ATTRIBUTE || "uid",
      username: username,
      attributes: ["dn", "sn", "cn"],
    };
  }

  private static hashPassword(password: string): string {
    const crypto = require("crypto");
    return crypto.createHash("sha256").update(password).digest("hex");
  }

  static async createUser(userData: IUser): Promise<IUser | null> {
    try {
      // console.log("Creating user with data:", userData);
      const newUser = new User(userData);
      newUser.password = this.hashPassword(newUser.password || ""); // Hash password if provided
      newUser.lastLogin = getDateWithTimezone(7); // Set last login to current time with timezone offset
      await newUser.save();
      return newUser;
    } catch (error) {
      console.error("Error creating user:", error);
      return null;
    }
  }

  static async authenticateUser(
    username: string,
    password: string
  ): Promise<AuthResult> {
    try {
      const u_id =
        username.startsWith("it") && username.length === 10
          ? username.substring(2) // Cut "it" prefix
          : username; // Use username as is if not starting with "it"

      const passwordHash = this.hashPassword(password);
      let ldapDown = false;

      console.log("Password Hash:", passwordHash);

      // Step 1: Try LDAP authentication first (prioritized)
      const ldapConfig = this.getLDAPConfig(username, password);
      let ldapResult;
      try {
        ldapResult = await authenticate(ldapConfig);
      } catch (ldapError: any) {
        // Check if LDAP is down (connection error) vs invalid credentials
        const isConnectionError =
          ldapError?.code === 'ECONNREFUSED' ||
          ldapError?.code === 'ETIMEDOUT' ||
          ldapError?.code === 'ENOTFOUND' ||
          ldapError?.code === 'ENETUNREACH' ||
          ldapError?.message?.includes('connect') ||
          ldapError?.message?.includes('timeout') ||
          ldapError?.message?.includes('ECONNREFUSED');

        if (isConnectionError) {
          console.warn("LDAP server is down, falling back to MongoDB authentication");
          ldapDown = true;
        } else {
          // LDAP is up but credentials are invalid
          console.error("LDAP authentication failed (invalid credentials):", ldapError);
          return {
            success: false,
            message: "Invalid credentials",
          };
        }
      }

      // Step 2: If LDAP authentication succeeded
      if (ldapResult) {
        let user = await User.findOne({ u_id: u_id.toLowerCase() });

        if (user) {
          // User exists, update their password hash and last login
          user.password = passwordHash;
          user.lastLogin = getDateWithTimezone(7);
          user.ldapAuthenticated = true;
          await user.save();
          user.password = undefined; // Remove password from user object before returning
          return {
            success: true,
            user,
            message: "Authentication successful (LDAP)",
          };
        } else {
          // Create new user from LDAP data
          const newUser = new User({
            u_id: u_id.toLowerCase(),
            fullName: ldapResult.displayName || ldapResult.cn || username,
            password: password,
            role: this.determineUserRole(ldapResult),
            ldapAuthenticated: true,
            lastLogin: getDateWithTimezone(7),
          });
          const createdUser = await this.createUser(newUser);

          if (!createdUser) {
            return {
              success: false,
              message: "Failed to create user in MongoDB",
            };
          }

          // Create GNS3 user and resource pool in background (non-blocking)
          this.createGNS3UserAndPool(u_id, createdUser.fullName || username, password)
            .then((result) => {
              if (result.success) {
                console.log(`GNS3 user and pool created for ${u_id}`);
              } else {
                console.warn(`Failed to create GNS3 user/pool for ${u_id}:`, result.error);
              }
            })
            .catch((err) => {
              console.error(`Error creating GNS3 user/pool for ${u_id}:`, err);
            });

          return {
            success: true,
            user: createdUser,
            isFirstTimeLogin: true,
            message: "Authentication successful - new user created (LDAP)",
          };
        }
      }

      // Step 3: LDAP is down - fallback to MongoDB authentication
      if (ldapDown) {
        let user = await User.findOne({ u_id: u_id.toLowerCase() });

        if (user) {
          // Check password against stored hash
          if (user.password === passwordHash) {
            user.lastLogin = getDateWithTimezone(7);
            await user.save();
            user.password = undefined;
            return {
              success: true,
              user,
              message: "Authentication successful (MongoDB fallback - LDAP unavailable)",
            };
          } else {
            return {
              success: false,
              message: "Invalid credentials",
            };
          }
        } else {
          // User doesn't exist in MongoDB and LDAP is down
          return {
            success: false,
            message: "LDAP service unavailable and user not found in local database",
          };
        }
      }

      // If we reach here, LDAP didn't return a result but also didn't throw
      return {
        success: false,
        message: "Invalid credentials",
      };
    } catch (error) {
      console.error("Authentication error:", error);
      return {
        success: false,
        message: "Authentication failed due to server error",
      };
    }
  }

  private static determineUserRole(
    ldapUser: any
  ): "INSTRUCTOR" | "STUDENT" | "VIEWER" {
    // Default role assignment logic
    // You can customize this based on LDAP groups or attributes

    if (ldapUser?.dn) {
      const groups = ldapUser?.dn.split(",") || [];
      const adminGroups = "OU=Lecturer";
      if (
        groups.some(
          (group: string) => group.toLowerCase() === adminGroups.toLowerCase()
        )
      ) {
        return "INSTRUCTOR";
      }

      const studentGroups = "OU=Student";
      if (
        groups.some(
          (group: string) => group.toLowerCase() === studentGroups.toLowerCase()
        )
      ) {
        console.log("User is a student based on LDAP group");
        return "STUDENT";
      }
    }

    return "VIEWER";
  }

  static async getUserById(userId: string): Promise<IUser | null> {
    try {
      return await User.findById(userId);
    } catch (error) {
      console.error("Error finding user by ID:", error);
      return null;
    }
  }

  static async getUserByUsername(username: string): Promise<IUser | null> {
    try {
      return await User.findOne({ u_id: username.toLowerCase() });
    } catch (error) {
      console.error("Error finding user by username:", error);
      return null;
    }
  }

  static async updateUserLastLogin(userId: string): Promise<boolean> {
    try {
      await User.findByIdAndUpdate(userId, { lastLogin: new Date() });
      return true;
    } catch (error) {
      console.error("Error updating user last login:", error);
      return false;
    }
  }

  /**
   * Create a GNS3 user and resource pool for a student
   * This is called on first-time LDAP login to set up their GNS3 environment
   * Can also be called from admin endpoints to sync existing users
   */
  static async createGNS3UserAndPool(
    studentId: string,
    fullName: string,
    password: string
  ): Promise<{ success: boolean; error?: string; userId?: string; poolId?: string }> {
    try {
      // Step 1: Login as admin to GNS3
      const loginResult = await GNS3v3Service.login();
      if (!loginResult.success || !loginResult.accessToken) {
        return { success: false, error: loginResult.error || "Failed to connect to GNS3" };
      }
      const token = loginResult.accessToken;

      // Step 2: Create user with naming convention "it<student_id>"
      const gns3Username = `it${studentId}`;
      const userResult = await GNS3v3Service.createUser(token, {
        username: gns3Username,
        password: password,
        fullName: fullName,
      });

      if (!userResult.success || !userResult.userId) {
        return { success: false, error: userResult.error || "Failed to create GNS3 user" };
      }

      // Step 3: Create resource pool with naming convention "it<student_id>-pool"
      const poolName = `it${studentId}-pool`;
      const poolResult = await GNS3v3Service.createPool(token, poolName);

      if (!poolResult.success || !poolResult.poolId) {
        return { success: false, error: poolResult.error || "Failed to create GNS3 resource pool" };
      }

      // Step 4: Get Student role
      const roleResult = await GNS3v3Service.getStudentRoleId(token);
      if (!roleResult.success || !roleResult.roleId) {
        console.warn("Could not get Student role for ACE creation:", roleResult.error);
        // Continue anyway, user and pool are created
      } else {
        // Step 5: Create ACE to give user access to their pool
        const aceResult = await GNS3v3Service.createACE(token, {
          userId: userResult.userId,
          roleId: roleResult.roleId,
          poolId: poolResult.poolId,
        });

        if (!aceResult.success) {
          console.warn("Failed to create ACE:", aceResult.error);
          // Continue anyway, user and pool are created
        }
      }

      console.log(`GNS3 setup complete for student ${studentId}: user=${gns3Username}, pool=${poolName}`);
      return {
        success: true,
        userId: userResult.userId,
        poolId: poolResult.poolId,
      };
    } catch (error) {
      const err = error as Error;
      return { success: false, error: `GNS3 setup failed: ${err.message}` };
    }
  }
}
