import { Schema, model, Document, Types } from 'mongoose';

export interface ILabPart extends Document {
  lab_id: Types.ObjectId;
  title: string;
  textMd?: string;
  order: number;
  totalPoints: number;
  prerequisites?: String[];
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

const labPartSchema = new Schema<ILabPart>({
  lab_id: {
    type: Schema.Types.ObjectId,
    required: true,
    ref: 'Lab'
  },
  title: {
    type: String,
    required: true,
    maxlength: 200,
    trim: true
  },
  textMd: {
    type: String,
    required: false,
    maxlength: 10000
  },
  order: {
    type: Number,
    required: true,
    min: 1
  },
  totalPoints: {
    type: Number,
    required: true,
    min: 0
  },
  prerequisites: {
    type: [String],
    required: false,
    ref: 'LabPart',
    default: []
  },
  createdBy: {
    type: String,
    required: true,
    ref: 'User'
  }
}, {
  timestamps: true
});

export const LabPart = model<ILabPart>('LabPart', labPartSchema, 'lab_parts');