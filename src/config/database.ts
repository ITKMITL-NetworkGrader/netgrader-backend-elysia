import mongoose from "mongoose";
import { env } from "process";

export async function connectDatabase() {
  const uri = env.DATABASE_URL || "mongodb://localhost:27017";
  // console.log(`${uri}${dbName}`);
  await mongoose.connect(`${uri}`);
  console.log("Connected to MongoDB with Mongoose");
}

export async function closeDatabase(): Promise<void> {
  await mongoose.connection.close();
  console.log("Disconnected from MongoDB");
}