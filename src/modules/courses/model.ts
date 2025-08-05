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

  // generate a salt
  bcrypt.genSalt(10, function (err, salt) {
    if (err) return next(err);

    // hash the password using our new salt
    if (course.password) {
      bcrypt.hash(course.password, salt, function (err, hash) {
        if (err) return next(err);
        // override the cleartext password with the hashed one
        course.password = hash;
        next();
      });
    }
  });
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
