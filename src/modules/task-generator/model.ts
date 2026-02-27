import { Schema, model, Document } from 'mongoose';

// ============================================================================
// Task Generator Session
// ============================================================================

export interface ITaskGeneratorSession extends Document {
    sessionId: string;
    userId: string;
    title: string;
    status: 'active' | 'expired';
    createdAt: Date;
    updatedAt: Date;
    lastMessageAt: Date;
}

const taskGeneratorSessionSchema = new Schema<ITaskGeneratorSession>({
    sessionId: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    userId: {
        type: String,
        required: true,
        index: true
    },
    title: {
        type: String,
        required: true,
        default: 'Untitled'
    },
    status: {
        type: String,
        enum: ['active', 'expired'],
        default: 'active',
        required: true
    },
    lastMessageAt: {
        type: Date,
        default: Date.now,
        required: true
    }
}, {
    timestamps: true
});

taskGeneratorSessionSchema.index({ userId: 1, status: 1 });
taskGeneratorSessionSchema.index({ lastMessageAt: -1 });

export const TaskGeneratorSession = model<ITaskGeneratorSession>(
    'TaskGeneratorSession',
    taskGeneratorSessionSchema,
    'task_generator_sessions'
);

// ============================================================================
// Task Generator Message
// ============================================================================

export interface ITaskGeneratorMessage extends Document {
    sessionId: string;
    messageId: string;
    role: 'user' | 'model';
    userId: string | null;       // u_id ของผู้ส่ง (null สำหรับ model)
    modelName: string | null;    // ชื่อ model เช่น "Gemini" (null สำหรับ user)
    content: string;
    timestamp: Date;
}

const taskGeneratorMessageSchema = new Schema<ITaskGeneratorMessage>({
    sessionId: {
        type: String,
        required: true,
        index: true
    },
    messageId: {
        type: String,
        required: true,
        unique: true
    },
    role: {
        type: String,
        enum: ['user', 'model'],
        required: true
    },
    userId: {
        type: String,
        required: false,
        default: null
    },
    modelName: {
        type: String,
        required: false,
        default: null
    },
    content: {
        type: String,
        required: true,
        default: ''
    },
    timestamp: {
        type: Date,
        default: Date.now,
        required: true
    }
});

taskGeneratorMessageSchema.index({ sessionId: 1, timestamp: 1 });

export const TaskGeneratorMessage = model<ITaskGeneratorMessage>(
    'TaskGeneratorMessage',
    taskGeneratorMessageSchema,
    'task_generator_messages'
);
