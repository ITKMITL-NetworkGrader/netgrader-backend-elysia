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

export const Enrollment = model<IEnrollment>("Enrollment", enrollmentSchema);
