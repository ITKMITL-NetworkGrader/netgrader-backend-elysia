import { Schema, model } from "mongoose";
import { t } from "elysia";

const enrollmentSchema = new Schema({
    studentId: {
        type: String,
        required: true
    },
    courseId: {
        type: String,
        required: true
    },
    enrollmentDate: {
        type: Date,
        default: Date.now
    }
});

export const Enrollment = model("Enrollment", enrollmentSchema);
export const enrollmentBody = t.Object({
    studentId: t.String(),
    courseId: t.String(),
    enrollmentDate: t.Optional(t.Date())
});
export type enrollmentBody = typeof enrollmentBody;