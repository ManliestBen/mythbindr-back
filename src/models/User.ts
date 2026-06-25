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
    /**
     * Spotify integration (PLAN.md §5.12a). Tokens are encrypted at rest
     * (see lib/crypto.ts) and never returned to the client; the browser gets a
     * short-lived access token from the /integrations/spotify/token route.
     */
    spotify: {
      connected: { type: Boolean, default: false },
      accessToken: { type: String }, // encrypted
      refreshToken: { type: String }, // encrypted
      expiresAt: { type: Date },
      scope: { type: String },
      productTier: { type: String }, // 'premium' | 'free' | 'open' | 'unknown'
      spotifyUserId: { type: String },
      displayName: { type: String },
      connectedAt: { type: Date },
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
