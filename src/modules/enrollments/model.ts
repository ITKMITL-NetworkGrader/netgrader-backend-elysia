import { Schema, model } from "mongoose";

export interface IEnrollment {
    u_id: string;
    c_id: string;
    u_role: "INSTRUCTOR" | "STUDENT" | "TA";
    enrollmentDate: Date;
}

const enrollmentSchema = new Schema({
    u_id: {
        type: String,
        required: true
    },
    c_id: {
        type: String,
        required: true
    },
    u_role: {
        type: String,
        enum: ["INSTRUCTOR", "STUDENT", "TA"],
        default: "STUDENT"
    },
    enrollmentDate: {
        type: Date,
        default: Date.now
    }
});

// Indexes for efficient querying
enrollmentSchema.index({ u_id: 1, c_id: 1 }, { unique: true }); // Primary lookup - user in course
enrollmentSchema.index({ c_id: 1, u_role: 1 }); // Course role queries
enrollmentSchema.index({ u_id: 1 }); // User's enrollments
enrollmentSchema.index({ c_id: 1 }); // Course's enrollments
enrollmentSchema.index({ enrollmentDate: -1 }); // Sort by enrollment date

export const Enrollment = model<IEnrollment>("Enrollment", enrollmentSchema);
