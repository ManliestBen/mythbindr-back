import { Schema, model, InferSchemaType, Types } from 'mongoose';

const userSchema = new Schema(
  {
    displayName: { type: String, required: true, trim: true },
    /** Stable per-user handle (base64url) used as the WebAuthn user id. */
    webauthnUserID: { type: String, required: true, unique: true },
    /** Account-level admin. Gates AI features (PLAN.md §5.14). Server-checked only. */
    isAdmin: { type: Boolean, default: false },
    theme: { type: String, default: 'mythic-gold' },
    uiDensity: {
      type: String,
      enum: ['beginner', 'advanced'],
      default: 'beginner',
    },
  },
  { timestamps: true },
);

export type UserDoc = InferSchemaType<typeof userSchema> & {
  _id: Types.ObjectId;
};

export const User = model('User', userSchema);

/** Shape returned to the client — never leak internal fields. */
export function publicUser(user: UserDoc) {
  return {
    id: String(user._id),
    displayName: user.displayName,
    isAdmin: user.isAdmin,
    theme: user.theme,
  };
}
