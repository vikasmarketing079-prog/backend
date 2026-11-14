import mongoose from 'mongoose';
import { ENV } from './env.js';

export async function connectDB(): Promise<void> {
  try {
    const conn = await mongoose.connect(ENV.MONGODB_URI, {
      serverSelectionTimeoutMS: 8000,
    });
    console.log(`[Database] MongoDB Connected: ${conn.connection.host}/${conn.connection.name}`);
  } catch (error: any) {
    console.error('[Database] MongoDB Connection Warning:', error.message || error);
  }
}


