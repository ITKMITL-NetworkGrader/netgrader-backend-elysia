import { Schema, model } from "mongoose";
import { t } from "elysia";
import { getDateWithTimezone } from "../utils/helpers.js";
import { env } from "process";

const TIMEZONE_OFFSET_HOURS = env.TIMEZONE_OFFSET ? parseInt(env.TIMEZONE_OFFSET) : 7;

const courseSchema = new Schema({
    title: {
        type: String,
        required: true,
    },
    description: {
        type: String,
        required: true,
    },
    instructor: {
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

export const Course = model("Course", courseSchema);

export const courseBody = t.Object({
    title: t.String(),
    description: t.String(),
    instructor: t.String(),
    updatedAt: t.Optional(t.Date()),
    createdAt: t.Optional(t.Date()),
})
export type courseBody = typeof courseBody;