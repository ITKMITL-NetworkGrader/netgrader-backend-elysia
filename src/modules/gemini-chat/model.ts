import { Schema, model, Document } from 'mongoose';

// ============================================================================
// Chat Session - เก็บ session และ context
// ============================================================================

export interface IChatSession extends Document {
    sessionId: string;              // UUID
    userId: string;                 // อาจารย์ (จาก JWT u_id)
    cacheId?: string;               // Gemini Context Cache name

    // Context - สามารถเปลี่ยนผ่านแชทได้
    currentContext: {
        courseId?: string;
        labId?: string;
        partId?: string;
    };

    status: 'active' | 'expired';
    createdAt: Date;
    updatedAt: Date;
    lastMessageAt: Date;
}

const chatSessionSchema = new Schema<IChatSession>({
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
    cacheId: {
        type: String,
        required: false
    },
    currentContext: {
        courseId: { type: String, required: false },
        labId: { type: String, required: false },
        partId: { type: String, required: false }
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

// Indexes
chatSessionSchema.index({ userId: 1, status: 1 });
chatSessionSchema.index({ lastMessageAt: -1 });

export const ChatSession = model<IChatSession>('ChatSession', chatSessionSchema, 'chat_sessions');

// ============================================================================
// Chat Message - เก็บทุกข้อความ + drafts
// ============================================================================

export interface IChatMessage extends Document {
    sessionId: string;
    messageId: string;              // UUID
    role: 'user' | 'model' | 'system';

    // Content
    textContent: string;
    humanReadablePreview?: string;  // Preview แบบ Markdown อ่านง่าย
    jsonPreview?: Record<string, any>;  // Preview แบบ JSON

    // Function Calling
    functionCall?: {
        name: string;
        args: Record<string, any>;
        status: 'pending' | 'approved' | 'rejected' | 'executed';
    };

    // Draft data
    draftData?: {
        type: 'lab' | 'part' | 'task';
        data: Record<string, any>;     // Full object ที่พร้อมสร้าง
        previewText: string;           // Human-readable summary
    };

    timestamp: Date;
}

const chatMessageSchema = new Schema<IChatMessage>({
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
        enum: ['user', 'model', 'system'],
        required: true
    },
    textContent: {
        type: String,
        required: true,
        default: ''
    },
    humanReadablePreview: {
        type: String,
        required: false
    },
    jsonPreview: {
        type: Schema.Types.Mixed,
        required: false
    },
    functionCall: {
        name: { type: String, required: false },
        args: { type: Schema.Types.Mixed, required: false },
        status: {
            type: String,
            enum: ['pending', 'approved', 'rejected', 'executed'],
            required: false
        }
    },
    draftData: {
        type: {
            type: String,
            enum: ['lab', 'part', 'task'],
            required: false
        },
        data: { type: Schema.Types.Mixed, required: false },
        previewText: { type: String, required: false }
    },
    timestamp: {
        type: Date,
        default: Date.now,
        required: true
    }
});

// Indexes
chatMessageSchema.index({ sessionId: 1, timestamp: 1 });
chatMessageSchema.index({ 'functionCall.status': 1 });

export const ChatMessage = model<IChatMessage>('ChatMessage', chatMessageSchema, 'chat_messages');
