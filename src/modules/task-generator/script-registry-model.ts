import { Schema, model, Document } from 'mongoose';

// ============================================================================
// Script Argument Schema
// ============================================================================

export interface IScriptArgument {
    name: string;
    description: string;
    required: boolean;
    defaultValue?: string;
}

const scriptArgumentSchema = new Schema<IScriptArgument>({
    name: {
        type: String,
        required: true
    },
    description: {
        type: String,
        required: true,
        default: ''
    },
    required: {
        type: Boolean,
        required: true,
        default: true
    },
    defaultValue: {
        type: String,
        required: false,
        default: undefined
    }
}, { _id: false });

// ============================================================================
// Script Registry
// ============================================================================

export interface IScriptRegistry extends Document {
    scriptId: string;
    action: string;
    deviceType: 'host' | 'network_device';
    os: 'linux' | 'cisco';
    description: string;
    arguments: IScriptArgument[];
    scriptPath: string;
    source: 'manual' | 'generated';
    createdAt: Date;
    updatedAt: Date;
}

const scriptRegistrySchema = new Schema<IScriptRegistry>({
    scriptId: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    action: {
        type: String,
        required: true
    },
    deviceType: {
        type: String,
        enum: ['host', 'network_device'],
        required: true
    },
    os: {
        type: String,
        enum: ['linux', 'cisco'],
        required: true
    },
    description: {
        type: String,
        required: true,
        default: ''
    },
    arguments: {
        type: [scriptArgumentSchema],
        default: []
    },
    scriptPath: {
        type: String,
        required: true
    },
    source: {
        type: String,
        enum: ['manual', 'generated'],
        default: 'generated',
        required: true
    }
}, {
    timestamps: true
});

// Unique combination: action + deviceType + os + argument signature
// เพื่อให้สามารถมี script หลายตัวสำหรับ action เดียวกัน แต่ argument ต่างกัน
scriptRegistrySchema.index({ action: 1, deviceType: 1, os: 1 });

export const ScriptRegistry = model<IScriptRegistry>(
    'ScriptRegistry',
    scriptRegistrySchema,
    'script_registry'
);
