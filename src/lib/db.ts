import mongoose from 'mongoose';
import { env } from './env';

/**
 * Connect to MongoDB. Resolves once the initial connection is established,
 * or rejects (after the server-selection timeout) if it can't reach the cluster.
 */
export async function connectToDatabase(): Promise<typeof mongoose> {
  mongoose.set('strictQuery', true);
  await mongoose.connect(env.mongodbUri, {
    serverSelectionTimeoutMS: 10_000,
  });
  return mongoose;
}

export async function disconnectFromDatabase(): Promise<void> {
  await mongoose.disconnect();
}
