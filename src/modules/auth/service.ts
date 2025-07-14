import { authenticate } from "ldap-authentication";
import { User, IUser } from "./model";
import { env } from "process";
import { getDateWithTimezone } from "../../utils/helpers.js";
import { get } from "mongoose";


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
      console.log("Creating user with data:", userData);
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
      // Step 1: Check if user exists in MongoDB
      const passwordHash = this.hashPassword(password);

      console.log("Password Hash:", passwordHash);

      let user = await User.findOne({ u_id: u_id.toLowerCase() });
      // If user exists
      
      if (user) {
        //----------------------------------------------------------------------------------
        // New Section: Check if user is LDAP authenticated
        // Step 1.1: Check if user
        if (user.password !== passwordHash) {
          // User exists in MongoDB but password does not match
          return {
            success: false,
            message: "Invalid credentials (User exists, but password mismatch)",
          };
        }
        else if (user.password === passwordHash) {
          // User exists in MongoDB and is LDAP authenticated
          user.lastLogin = getDateWithTimezone(7); // Set last login to current time with timezone offset
          await user.save();
          user.password = undefined; // Remove password from user object before returning
          return {
            success: true,
            user,
            message: "Authentication successful",
          };
        }
        //----------------------------------------------------------------------------------
        // Old Section 
        // if (!user.password) {
        //   const ldapConfig = this.getLDAPConfig(username, password);
        //   let ldapResult;
        //   try {
        //     ldapResult = await authenticate(ldapConfig);
        //   } catch (ldapError) {
        //     console.error("LDAP authentication failed:", ldapError);
        //     return {
        //       success: false,
        //       message: "Invalid credentials (User exists, but ldap error)",
        //     };
        //   }

        //   if (!ldapResult) {
        //     return {
        //       success: false,
        //       message: "Invalid credentials (User exists, but no ldap result)",
        //     };
        //   }
        // } else if (user.password) {

        // }
        // // User exists in MongoDB, update last login
        // user.lastLogin = new Date();
        // await user.save();

        // return {
        //   success: true,
        //   user,
        //   isFirstTimeLogin: false,
        //   message: "Authentication successful - existing user",
        // } ;
      }
      // Step 2 : If user not existing in MongoDB then authen with IT LDAP
      const ldapConfig = this.getLDAPConfig(username, password);
      let ldapResult;
      try {
        ldapResult = await authenticate(ldapConfig);
      } catch (ldapError) {
        console.error("LDAP authentication failed:", ldapError);
        return {
          success: false,
          message: "LDAP authentication failed",
        };
      }

      if (!ldapResult) {
        return {
          success: false,
          message: "Invalid credentials",
        };
      }
      const newUser = new User({
        u_id: u_id.toLowerCase(),
        fullName: ldapResult.displayName || ldapResult.cn || username,
        password: password,
        role: this.determineUserRole(ldapResult),
        ldapAuthenticated: true,
        lastLogin: getDateWithTimezone(7), // Set last login to current time with timezone offset
      });
      const createdUser = await this.createUser(newUser);
      // If user creation fails, return an error
      if (!createdUser) {
        return {
          success: false,
          message: "Failed to create user in MongoDB",
        };
      }

      return {
        success: true,
        user: createdUser,
        isFirstTimeLogin: true,
        message: "Authentication successful - new user created",
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
  ): "ADMIN" | "STUDENT" | "VIEWER" {
    // Default role assignment logic
    // You can customize this based on LDAP groups or attributes

    if (ldapUser.distinguishedName) {
      const groups = Array.isArray(ldapUser.distinguishedName)
        ? ldapUser.distinguishedName
        : [ldapUser.distinguishedName];

      // Check for admin groups
      const adminGroups = "OU=Lecturer";
      if (
        groups.some(
          (group: string) => group.toLowerCase() === adminGroups.toLowerCase()
        )
      ) {
        return "ADMIN";
      }

      // Check for student groups
      const studentGroups = "OU=Student";
      if (
        groups.some(
          (group: string) => group.toLowerCase() === studentGroups.toLowerCase()
        )
      ) {
        return "STUDENT";
      }
    }

    // Check specific attributes
    if (
      ldapUser.employeeType === "teacher" ||
      ldapUser.employeeType === "admin"
    ) {
      return "ADMIN";
    }

    // Default to STUDENT
    return "STUDENT";
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
}
