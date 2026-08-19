import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

declare global {
  var __roocGuildDbClient: ReturnType<typeof postgres> | undefined;
}

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "DATABASE_URL is not set. Add it to your environment variables (see .env.example)."
  );
}

// Reuse a single connection pool across hot reloads in dev and across
// serverless invocations within the same runtime instance.
const client =
  global.__roocGuildDbClient ??
  postgres(connectionString, {
    max: process.env.NODE_ENV === "production" ? 5 : 1,
  });

if (process.env.NODE_ENV !== "production") {
  global.__roocGuildDbClient = client;
}

export const db = drizzle(client, { schema });
