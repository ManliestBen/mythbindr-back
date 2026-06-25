import { Schema, model, InferSchemaType, Types } from 'mongoose';

const activitySchema = new Schema(
  {
    campaignId: { type: Schema.Types.ObjectId, ref: 'Campaign', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    action: {
      type: String,
      enum: ['created', 'updated', 'deleted', 'restored'],
      required: true,
    },
    elementId: { type: Schema.Types.ObjectId, ref: 'Element' },
    elementType: { type: String },
    elementName: { type: String },
  },
  { timestamps: true },
);

export type ActivityDoc = InferSchemaType<typeof activitySchema> & {
  _id: Types.ObjectId;
  createdAt: Date;
};

export const Activity = model('Activity', activitySchema);

/** Record a campaign activity entry. Non-critical: never throws into the request path. */
export async function logActivity(input: {
  campaignId: Types.ObjectId | string;
  userId: Types.ObjectId | string | undefined;
  action: 'created' | 'updated' | 'deleted' | 'restored';
  elementId?: Types.ObjectId | string;
  elementType?: string;
  elementName?: string;
}): Promise<void> {
  try {
    if (!input.userId) return;
    await Activity.create(input);
  } catch {
    /* activity logging is best-effort */
  }
}
