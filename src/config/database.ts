import mongoose from "mongoose";
import { env } from "process";

export async function connectDatabase() {
  const uri = env.DATABASE_URL || "mongodb://localhost:27017";
  // DEEP2-16: Fail fast on default MongoDB connection in production
  if (env.NODE_ENV === "production" && uri === "mongodb://localhost:27017") {
    console.error("FATAL: DATABASE_URL not configured for production");
    process.exit(1);
  }
  await mongoose.connect(`${uri}`);
  console.log("Connected to MongoDB with Mongoose");
}

export async function closeDatabase(): Promise<void> {
  await mongoose.connection.close();
  console.log("Disconnected from MongoDB");
}