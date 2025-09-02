import { Schema, model, Document } from 'mongoose';

export interface ILabNetwork extends Document {
  name: string;
  ipSchema: Record<string, any>;
  deviceMappings: Array<Record<string, any>>;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

const labNetworkSchema = new Schema<ILabNetwork>({
  name: {
    type: String,
    required: true,
    maxlength: 100,
    trim: true
  },
  ipSchema: {
    type: Schema.Types.Mixed,
    required: true
  },
  deviceMappings: {
    type: [Object],
    required: true,
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

export const LabNetwork = model<ILabNetwork>('LabNetwork', labNetworkSchema, "lab_networks");