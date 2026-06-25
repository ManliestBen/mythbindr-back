import mongoose from 'mongoose';
import { connectToDatabase, disconnectFromDatabase } from '../lib/db';

/**
 * One-shot connectivity check: connect, ping the server, report the db name,
 * then disconnect. Exits 0 on success, 1 on failure.
 */
async function run(): Promise<void> {
  console.log('Connecting to MongoDB…');
  await connectToDatabase();

  const db = mongoose.connection.db;
  if (!db) throw new Error('Connected, but no database handle was available.');

  const ping = await db.admin().ping();
  console.log('Ping result:', ping);
  console.log(`Database name: ${mongoose.connection.name}`);
  console.log('✓ MongoDB connection OK');

  await disconnectFromDatabase();
  process.exit(0);
}

run().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error('✗ MongoDB connection FAILED:', message);
  process.exit(1);
});
