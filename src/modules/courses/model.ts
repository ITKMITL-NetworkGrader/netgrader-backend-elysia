import { Schema, model } from "mongoose";
import { t } from "elysia";
import { getDateWithTimezone } from "../../utils/helpers.js";
import { env } from "process";
import bcrypt from "bcrypt";

const TIMEZONE_OFFSET_HOURS = env.TIMEZONE_OFFSET
  ? parseInt(env.TIMEZONE_OFFSET)
  : 7;

export interface ICourse {
  title: string;
  description: string;
  password?: string; // optional, since required: false
  visibility: "public" | "private";
  created_by: string;
  createdAt: Date;
  updatedAt: Date;
  comparePassword(candidatePassword: string, cb: (err: Error | null, isMatch?: boolean) => void): void;
}

const courseSchema = new Schema({
  title: {
    type: String,
    required: true,
  },
  description: {
    type: String,
    required: true,
  },
  password: {
    type: String,
    required: false,
    select: false, // Exclude from default queries
  },
  visibility: {
    type: String,
    enum: ["public", "private"],
    default: "public",
  },
  created_by: {
    type: String,
    required: true,
  },
  createdAt: {
    type: Date,
    default: () => getDateWithTimezone(TIMEZONE_OFFSET_HOURS),
  },
  updatedAt: {
    type: Date,
    default: () => getDateWithTimezone(TIMEZONE_OFFSET_HOURS),
  },
});

courseSchema.pre("save", function (next) {
  var course = this;
  if (!course.isModified("password")) return next();

  // If password is undefined, null, or empty, skip hashing
  if (!course.password || course.password.trim() === '') {
    course.password = undefined; // Ensure it's undefined, not empty string
    return next();
  }

  // generate a salt
  bcrypt.genSalt(10, function (err, salt) {
    if (err) return next(err);

    // hash the password using our new salt
    bcrypt.hash(course.password as string, salt, function (err, hash) {
      if (err) return next(err);
      // override the cleartext password with the hashed one
      course.password = hash;
      next();
    });
  });
});

// Also handle findOneAndUpdate, findByIdAndUpdate operations
courseSchema.pre(["findOneAndUpdate", "updateOne"], async function (next) {
  const update = this.getUpdate() as any;
  
  // Check if we're using $set (most common in updates)
  const setUpdate = update.$set || update;
  
  // Check if password is being updated
  if (setUpdate && setUpdate.password !== undefined) {
    // If password is undefined, we want to unset it from the document
    if (setUpdate.password === undefined) {
      // Remove password from $set and add to $unset
      delete setUpdate.password;
      if (!update.$unset) update.$unset = {};
      update.$unset.password = 1;
      return next();
    }
    
    // If password is empty or whitespace, unset it
    if (!setUpdate.password || setUpdate.password.trim() === '') {
      delete setUpdate.password;
      if (!update.$unset) update.$unset = {};
      update.$unset.password = 1;
      return next();
    }
    
    try {
      // Hash the password
      const salt = await bcrypt.genSalt(10);
      const hash = await bcrypt.hash(setUpdate.password, salt);
      setUpdate.password = hash;
      next();
    } catch (error) {
      next(error as Error);
    }
  } else {
    next();
  }
});

courseSchema.methods.comparePassword = function (
  candidatePassword: string,
  cb: (err: Error | null, isMatch?: boolean) => void
) {
  bcrypt.compare(candidatePassword, this.password, function (err, isMatch) {
    if (err) return cb(err);
    cb(null, isMatch);
  });
};

export const Course = model<ICourse>("Course", courseSchema);

export const courseBody = t.Object({
  title: t.String(),
  description: t.String(),
  instructor: t.String(),
  visibility: t.Union([t.Literal("public"), t.Literal("private")]),
  updatedAt: t.Optional(t.Date()),
  createdAt: t.Optional(t.Date()),
});
export type courseBody = typeof courseBody;
