import { readFile } from "fs/promises";
import { Pool } from "pg";
import { config } from "./config.js";

const run = async () => {
  if (!config.databaseUrl) {
    throw new Error("DATABASE_URL is required to run migrations.");
  }

  const pool = new Pool({ connectionString: config.databaseUrl });
  const migrationUrl = new URL("../migrations/001_init.sql", import.meta.url);
  const sql = await readFile(migrationUrl, "utf8");

  await pool.query(sql);
  await pool.end();
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
