import { Schema, model, InferSchemaType, Types } from 'mongoose';

const credentialSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    /** Credential ID (base64url string). */
    credentialID: { type: String, required: true, unique: true },
    /** COSE public key bytes. */
    publicKey: { type: Buffer, required: true },
    /** Signature counter for clone detection. */
    counter: { type: Number, required: true, default: 0 },
    transports: { type: [String], default: [] },
    deviceType: { type: String },
    backedUp: { type: Boolean, default: false },
    deviceName: { type: String, default: 'Passkey' },
    lastUsedAt: { type: Date },
  },
  { timestamps: true },
);

export type CredentialDoc = InferSchemaType<typeof credentialSchema> & {
  _id: Types.ObjectId;
};

export const Credential = model('Credential', credentialSchema);
