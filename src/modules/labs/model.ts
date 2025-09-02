import { Schema, model, Document, Types } from 'mongoose';

export interface ILab extends Document {
  title: string;
  description?: string;
  type?: 'lab' | 'exam';
  courseId: string;
  network_id: string;
  createdBy: string;
  groupsRequired: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const labSchema = new Schema<ILab>({
  title: {
    type: String,
    required: true,
    maxlength: 200,
    trim: true
  },
  description: {
    type: String,
    required: false,
    maxlength: 2000,
    trim: true
  },
  type: {
    type: String,
    required: false,
    enum: ['lab', 'exam'],
    default: 'lab'
  },
  courseId: {
    type: String,
    required: true,
    ref: 'Course'
  },
  network_id: {
    type: String,
    required: true,
    ref: 'LabNetwork'
  },
  createdBy: {
    type: String,
    required: true,
    ref: 'User'
  },
  groupsRequired: {
    type: Boolean,
    required: true,
    default: false
  }
}, {
  timestamps: true
});

export const Lab = model<ILab>('Lab', labSchema);