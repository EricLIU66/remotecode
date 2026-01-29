#!/usr/bin/env node

import { spawn } from "node:child_process";

const isWindows = process.platform === "win32";
const npmCmd = isWindows ? "npm.cmd" : "npm";

const args = new Set(process.argv.slice(2));
const runRelay = !args.has("--no-relay");
const runFrontend = !args.has("--no-frontend") && !args.has("--no-web");

if (!runRelay && !runFrontend) {
  process.stderr.write("Nothing to run. Remove --no-relay/--no-frontend.\n");
  process.exit(1);
}

const children = [];

const start = (name, cmd, cmdArgs, options = {}) => {
  const child = spawn(cmd, cmdArgs, {
    stdio: "inherit",
    ...options,
  });

  children.push({ name, child });
  child.on("exit", (code, signal) => {
    const suffix = signal ? ` (signal ${signal})` : "";
    if (code === 0) {
      process.stderr.write(`${name} exited cleanly${suffix}\n`);
      return;
    }

    process.stderr.write(`${name} exited with code ${code ?? "?"}${suffix}\n`);
  });
  child.on("error", (error) => {
    process.stderr.write(`${name} failed to start: ${error?.message ?? error}\n`);
  });

  return child;
};

const shutdown = (signal) => {
  process.stderr.write(`\nShutting down (${signal})...\n`);
  for (const { child } of children) {
    if (child.exitCode !== null || child.killed) {
      continue;
    }

    try {
      child.kill(signal);
    } catch {
      // best-effort
    }
  }
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

if (runRelay) {
  start("relay", npmCmd, ["--prefix", "apps/relay", "run", "dev"]);
}

if (runFrontend) {
  start("frontend", npmCmd, ["--prefix", "apps/frontend", "run", "dev"]);
}
