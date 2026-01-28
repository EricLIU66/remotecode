#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import readline from "node:readline";

import QRCode from "qrcode";

import { requestPairing } from "./src/index.js";

const defaultRelayUrl = "http://localhost:8787";
const qrcodeVersion = "^1.5.4";

const usage = () => {
  console.error("Usage: remotecode <command>");
  console.error("");
  console.error("Commands:");
  console.error("  install   Install the plugin into .opencode/");
  console.error("  auth      Pair a phone and persist device credentials");
};

const ensureDir = (dirPath) => {
  fs.mkdirSync(dirPath, { recursive: true });
};

const readJsonFile = (filePath) => {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw);
};

const writeJsonFile = (filePath, value) => {
  const contents = JSON.stringify(value, null, 2);
  fs.writeFileSync(filePath, `${contents}\n`, "utf8");
};

const ensureRemoteCodeConfig = (configPath) => {
  const defaults = {
    relay_url: defaultRelayUrl,
    device_id: "",
    device_token: "",
  };

  if (!fs.existsSync(configPath)) {
    writeJsonFile(configPath, defaults);
    return { created: true, updated: true };
  }

  let config = null;

  try {
    config = readJsonFile(configPath);
  } catch {
    config = null;
  }

  if (!config || typeof config !== "object") {
    config = { ...defaults };
  }

  const nextConfig = {
    ...defaults,
    ...config,
  };

  if (!nextConfig.relay_url) {
    nextConfig.relay_url = defaultRelayUrl;
  }

  const changed = JSON.stringify(config) !== JSON.stringify(nextConfig);

  if (changed) {
    writeJsonFile(configPath, nextConfig);
  }

  return { created: false, updated: changed };
};

const resolveOpencodePaths = () => {
  const scriptPath = fileURLToPath(import.meta.url);
  const pluginRoot = path.dirname(scriptPath);
  const repoRoot = path.resolve(pluginRoot, "..", "..");
  const opencodeRoot = path.join(repoRoot, ".opencode");
  const pluginsDir = path.join(opencodeRoot, "plugins");
  const configPath = path.join(opencodeRoot, "remotecode.json");
  const packagePath = path.join(opencodeRoot, "package.json");
  const pluginPath = path.join(pluginsDir, "remotecode.js");

  return {
    repoRoot,
    opencodeRoot,
    pluginsDir,
    configPath,
    packagePath,
    pluginPath,
  };
};

const readConfig = (configPath) => {
  try {
    return readJsonFile(configPath) ?? {};
  } catch {
    return {};
  }
};

const writeConfig = (configPath, config) => {
  writeJsonFile(configPath, {
    relay_url: config.relay_url ?? defaultRelayUrl,
    device_id: config.device_id ?? "",
    device_token: config.device_token ?? "",
  });
};

const promptChoice = async (question, choices) => {
  if (!process.stdin.isTTY) {
    return choices[0]?.value;
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  try {
    for (;;) {
      rl.write(`${question}\n`);
      for (const choice of choices) {
        rl.write(`  ${choice.key}) ${choice.label}\n`);
      }
      const answer = await new Promise((resolve) => rl.question("> ", resolve));
      const normalized = String(answer ?? "").trim();
      const match = choices.find((choice) => choice.key === normalized);
      if (match) {
        return match.value;
      }
      rl.write("Invalid choice.\n\n");
    }
  } finally {
    rl.close();
  }
};

const renderPairingQr = async ({ relayUrl, deviceId, pairingToken, expiresAt }) => {
  const payload = JSON.stringify({
    relay_url: relayUrl,
    device_id: deviceId,
    pairing_token: pairingToken,
  });

  const qr = await QRCode.toString(payload, {
    type: "terminal",
    errorCorrectionLevel: "M",
  });

  if (expiresAt) {
    console.log(`pairing_qr_expires_at ${expiresAt}`);
  }

  console.log(`\n${qr}`);
};

const runAuth = async () => {
  const { opencodeRoot, configPath } = resolveOpencodePaths();

  ensureDir(opencodeRoot);
  ensureRemoteCodeConfig(configPath);

  const config = readConfig(configPath);
  const relayUrl = config.relay_url ?? defaultRelayUrl;
  const deviceId = config.device_id || null;
  const deviceToken = config.device_token || null;

  let pairing = null;
  try {
    pairing = await requestPairing({
      relayUrl,
      deviceId,
      deviceToken,
    });
  } catch (error) {
    console.error("remotecode_auth_pairing_request_failed", error);
    process.exitCode = 1;
    return;
  }

  writeConfig(configPath, {
    relay_url: relayUrl,
    device_id: pairing.deviceId,
    device_token: pairing.deviceToken,
  });

  console.log(`Saved device credentials to ${configPath}`);

  const method = await promptChoice("Choose pairing method:", [
    { key: "1", label: "Scan QR code (recommended)", value: "qr" },
    { key: "2", label: "Temporary code (manual)", value: "code" },
  ]);

  if (method === "code") {
    if (pairing.expiresAt) {
      console.log(`temporary_code_expires_at ${pairing.expiresAt}`);
    }
    console.log(`temporary_code ${pairing.pairingToken}`);
    console.log("Enter this code in the RemoteCode iOS app to complete pairing.");
    return;
  }

  try {
    await renderPairingQr({
      relayUrl,
      deviceId: pairing.deviceId,
      pairingToken: pairing.pairingToken,
      expiresAt: pairing.expiresAt,
    });
    console.log("Scan this QR code in the RemoteCode iOS app to complete pairing.");
  } catch (error) {
    console.error("remotecode_auth_qr_failed", error);
    process.exitCode = 1;
  }
};

const ensureOpencodePackage = (packagePath) => {
  const defaults = {
    name: "remotecode-opencode-config",
    private: true,
    type: "module",
    dependencies: {
      qrcode: qrcodeVersion,
    },
  };

  if (!fs.existsSync(packagePath)) {
    writeJsonFile(packagePath, defaults);
    return { created: true, updated: true };
  }

  let pkg = null;

  try {
    pkg = readJsonFile(packagePath);
  } catch {
    pkg = null;
  }

  if (!pkg || typeof pkg !== "object") {
    pkg = {};
  }

  if (!pkg.dependencies || typeof pkg.dependencies !== "object") {
    pkg.dependencies = {};
  }

  const nextPkg = {
    ...pkg,
    type: "module",
    private: true,
    dependencies: {
      ...pkg.dependencies,
      qrcode: pkg.dependencies.qrcode ?? qrcodeVersion,
    },
  };

  const changed = JSON.stringify(pkg) !== JSON.stringify(nextPkg);

  if (changed) {
    writeJsonFile(packagePath, nextPkg);
  }

  return { created: false, updated: changed };
};

const pluginEntryContents = `import fs from "node:fs";
import path from "node:path";

import QRCode from "qrcode";

import { createPlugin } from "../../apps/plugin/src/index.js";

const readJsonFile = (filePath) => {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }

    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const resolveConfig = (directory) => {
  const configPath = path.join(directory, ".opencode", "remotecode.json");
  const config = readJsonFile(configPath) ?? {};

  const relayUrl =
    config.relay_url ??
    process.env.RELAY_URL ??
    "http://localhost:8787";

  const deviceId =
    config.device_id || process.env.DEVICE_ID || null;

  const deviceToken =
    config.device_token || process.env.DEVICE_TOKEN || null;

  return { relayUrl, deviceId, deviceToken };
};

const shouldForwardEvent = (type) => {
  if (!type || typeof type !== "string") {
    return false;
  }

  return type.startsWith("session.") || type.startsWith("message.") || type.startsWith("tool.");
};

export const RemoteCode = async ({ client, directory }) => {
  const { relayUrl, deviceId, deviceToken } = resolveConfig(directory);

  const core = createPlugin({
    relayUrl,
    deviceId,
    deviceToken,
    logger: console,
    dependencies: {
      QRCode,
    },
  });

  await core.connect();

  let lastAgentsRefreshAt = 0;
  const refreshAgents = async () => {
    const now = Date.now();
    if (now - lastAgentsRefreshAt < 2000) {
      return;
    }

    lastAgentsRefreshAt = now;

    try {
      const response = await client.app.agents();
      const agents = response?.data ?? response;
      if (Array.isArray(agents)) {
        core.updateAgents(agents);
      }
    } catch (error) {
      console.warn("remotecode_agents_refresh_failed", error);
    }
  };

  return {
    event: async ({ event }) => {
      const type = event?.type;

      if (shouldForwardEvent(type)) {
        core.appendEvent({
          eventType: type,
          payload: event?.properties ?? event,
        });

        if (type.startsWith("session.")) {
          core.updateSessionSummary({
            last_event_type: type,
            ...(event?.properties ?? null),
          });
        }
      }

      await refreshAgents();
    },

    "tool.execute.before": async (input, output) => {
      core.appendEvent({
        eventType: "tool.execute.before",
        payload: {
          tool: input.tool,
          session_id: input.sessionID,
          call_id: input.callID,
          args: output.args,
        },
      });

      await refreshAgents();
    },

    "tool.execute.after": async (input, output) => {
      core.appendEvent({
        eventType: "tool.execute.after",
        payload: {
          tool: input.tool,
          session_id: input.sessionID,
          call_id: input.callID,
          title: output.title,
          metadata: output.metadata,
        },
      });

      await refreshAgents();
    },
  };
};
`;

const ensurePluginEntry = (pluginPath) => {
  if (!fs.existsSync(pluginPath)) {
    fs.writeFileSync(pluginPath, pluginEntryContents, "utf8");
    return { created: true, updated: true };
  }

  const current = fs.readFileSync(pluginPath, "utf8");
  if (current === pluginEntryContents) {
    return { created: false, updated: false };
  }

  fs.writeFileSync(pluginPath, pluginEntryContents, "utf8");
  return { created: false, updated: true };
};

const hasBun = () => {
  const result = spawnSync("bun", ["--version"], { stdio: "ignore" });
  return result.status === 0;
};

const runBunInstall = (cwd) => {
  const result = spawnSync("bun", ["install"], { cwd, stdio: "inherit" });
  return result.status === 0;
};

const run = async () => {
  const command = process.argv[2];

  if (!command || command === "--help" || command === "-h") {
    usage();
    process.exit(command ? 0 : 1);
  }

  if (command === "auth") {
    await runAuth();
    return;
  }

  if (command !== "install") {
    usage();
    process.exit(1);
  }

  const { opencodeRoot, pluginsDir, configPath, packagePath, pluginPath } = resolveOpencodePaths();

  ensureDir(pluginsDir);

  const configResult = ensureRemoteCodeConfig(configPath);
  if (configResult.created) {
    console.log(`Created ${configPath}`);
  } else if (configResult.updated) {
    console.log(`Updated ${configPath}`);
  }

  const pkgResult = ensureOpencodePackage(packagePath);
  if (pkgResult.created) {
    console.log(`Created ${packagePath}`);
  } else if (pkgResult.updated) {
    console.log(`Updated ${packagePath}`);
  }

  const pluginResult = ensurePluginEntry(pluginPath);
  if (pluginResult.created) {
    console.log(`Created ${pluginPath}`);
  } else if (pluginResult.updated) {
    console.log(`Updated ${pluginPath}`);
  }

  if (hasBun()) {
    if (!runBunInstall(opencodeRoot)) {
      process.exit(1);
    }
  } else {
    console.warn("bun not found. If OpenCode cannot install deps automatically, run: bun --cwd .opencode install");
  }

  console.log("RemoteCode OpenCode plugin installed. Restart opencode.");
};

run().catch((error) => {
  console.error("remotecode_cli_failed", error);
  process.exitCode = 1;
});
