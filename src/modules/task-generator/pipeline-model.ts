import { Schema, model, Document } from 'mongoose';

// ============================================================================
// Pipeline Run
// ============================================================================

export interface IPipelineRun extends Document {
    pipelineId: string;
    sessionId: string;
    userId: string;
    userMessage: string;
    status: 'running' | 'waiting_confirm' | 'completed' | 'error';
    currentStep: number;
    createdAt: Date;
    updatedAt: Date;
}

const pipelineRunSchema = new Schema<IPipelineRun>({
    pipelineId: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    sessionId: {
        type: String,
        required: true,
        index: true
    },
    userId: {
        type: String,
        required: true
    },
    userMessage: {
        type: String,
        required: true
    },
    status: {
        type: String,
        enum: ['running', 'waiting_confirm', 'completed', 'error'],
        default: 'running',
        required: true
    },
    currentStep: {
        type: Number,
        default: 1,
        required: true
    }
}, {
    timestamps: true
});

pipelineRunSchema.index({ sessionId: 1, createdAt: -1 });

export const PipelineRun = model<IPipelineRun>(
    'PipelineRun',
    pipelineRunSchema,
    'pipeline_runs'
);

// ============================================================================
// Pipeline Module
// ============================================================================

export type PipelineModuleName =
    | 'extract_intent'
    | 'decompose_tasks'
    | 'check_scripts'
    | 'generate_scripts'
    | 'execute_tasks';

export type PipelineModuleStatus =
    | 'pending'
    | 'running'
    | 'waiting_confirm'
    | 'confirmed'
    | 'error'
    | 'skipped';

export interface IPipelineModule extends Document {
    moduleId: string;
    pipelineId: string;
    step: number;
    moduleName: PipelineModuleName;
    status: PipelineModuleStatus;
    input: Record<string, unknown>;
    output: Record<string, unknown> | null;
    error: string | null;
    retryCount: number;
    userFeedback: string | null;
    confirmedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
}

const pipelineModuleSchema = new Schema<IPipelineModule>({
    moduleId: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    pipelineId: {
        type: String,
        required: true,
        index: true
    },
    step: {
        type: Number,
        required: true
    },
    moduleName: {
        type: String,
        enum: ['extract_intent', 'decompose_tasks', 'check_scripts', 'generate_scripts', 'execute_tasks'],
        required: true
    },
    status: {
        type: String,
        enum: ['pending', 'running', 'waiting_confirm', 'confirmed', 'error', 'skipped'],
        default: 'pending',
        required: true
    },
    input: {
        type: Schema.Types.Mixed,
        default: {}
    },
    output: {
        type: Schema.Types.Mixed,
        default: null
    },
    error: {
        type: String,
        default: null
    },
    retryCount: {
        type: Number,
        default: 0,
        required: true
    },
    userFeedback: {
        type: String,
        default: null
    },
    confirmedAt: {
        type: Date,
        default: null
    }
}, {
    timestamps: true
});

pipelineModuleSchema.index({ pipelineId: 1, step: 1 });

export const PipelineModule = model<IPipelineModule>(
    'PipelineModule',
    pipelineModuleSchema,
    'pipeline_modules'
);
