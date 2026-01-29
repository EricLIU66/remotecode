export const config = {
  host: process.env.HOST ?? "0.0.0.0",
  port: Number(process.env.PORT ?? 8787),
  databaseUrl: process.env.DATABASE_URL ?? "",
  tokenCleanupIntervalMs: Number(process.env.TOKEN_CLEANUP_INTERVAL_MS ?? 3600000),
  allowUnpairedDeviceWs:
    process.env.ALLOW_UNPAIRED_DEVICE_WS === "1" || process.env.ALLOW_UNPAIRED_DEVICE_WS === "true",
};
