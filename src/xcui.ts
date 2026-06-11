import { execFile, spawn, type ChildProcess } from "node:child_process";
import { promises as fs, openSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveBundleId } from "./session.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DRIVER_INFO = join(ROOT, "build", "driver", "driver-info.json");
const DRIVER_PROJECT = join(ROOT, "driver", "SimDriverHost", "SimDriverHost.xcodeproj");

const ACTIVE_DIR = "/tmp/open-sim/active";
const COMMAND_PATH = join(ACTIVE_DIR, "command.json");
const RESULT_PATH = join(ACTIVE_DIR, "result.json");
const STATUS_PATH = join(ACTIVE_DIR, "status.json");
const DAEMON_FLAG = join(ACTIVE_DIR, "daemon.flag");
const COMMAND_TMP = join(ACTIVE_DIR, "command.json.tmp");
const DAEMON_LOG = join(ROOT, "build", "driver", "daemon.log");

const DAEMON_READY_TIMEOUT_MS = 30_000; // cold attach ~13–20s; below this false-fails on slow machines
const COMMAND_TIMEOUT_MS = 10_000; // taps ~2s, describe ~7s
const POLL_MS = 15;

export interface ElementQuery {
  label?: string;
  labelContains?: string;
  identifier?: string;
  valueContains?: string;
  type?: string;
  index?: number;
}

export interface UICommand {
  bundleId?: string;
  action: string;
  query?: ElementQuery;
  x?: number;
  y?: number;
  normalized?: boolean;
  text?: string;
  direction?: string;
  fromX?: number;
  fromY?: number;
  toX?: number;
  toY?: number;
  duration?: number;
  timeout?: number;
  actions?: UICommand[];
}

export interface UIElementInfo {
  type: string;
  label?: string;
  identifier?: string;
  value?: string;
  placeholder?: string;
  frame: { x: number; y: number; width: number; height: number };
  enabled: boolean;
  hittable: boolean;
  selected: boolean;
  index: number;
}

export interface UIResult {
  success: boolean;
  action: string;
  bundleId?: string;
  screen?: { width: number; height: number };
  elements?: UIElementInfo[];
  matched?: UIElementInfo;
  error?: string;
  text?: string;
}

interface DriverInfo {
  xctestrun: string;
  derivedData: string;
  deviceName: string;
}

export class XcuiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "XcuiError";
  }
}

async function loadDriverInfo(): Promise<DriverInfo> {
  try {
    const raw = await fs.readFile(DRIVER_INFO, "utf8");
    return JSON.parse(raw) as DriverInfo;
  } catch {
    throw new XcuiError(
      "XCUITest driver not built. Run: npm run build:driver",
    );
  }
}

async function ensureSimulatorBooted(deviceName: string): Promise<void> {
  const { stdout } = await run("xcrun", ["simctl", "list", "devices", "booted", "--json"]);
  const data = JSON.parse(stdout) as { devices: Record<string, Array<{ name: string; state: string }>> };
  const booted = Object.values(data.devices).flat().filter((d) => d.state === "Booted");
  if (booted.some((d) => d.name === deviceName)) return;

  // Boot by name if not already running.
  await run("xcrun", ["simctl", "boot", deviceName]).catch(() => {
    /* may already be booted */
  });
}

function run(command: string, args: string[], env?: NodeJS.ProcessEnv): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      { timeout: 120_000, maxBuffer: 32 * 1024 * 1024, env: { ...process.env, ...env } },
      (error, stdout, stderr) => {
        resolve({
          stdout: stdout?.toString() ?? "",
          stderr: stderr?.toString() ?? "",
          exitCode: error ? 1 : 0,
        });
      },
    );
  });
}

async function buildDriver(deviceName: string): Promise<void> {
  const result = await run("bash", [join(ROOT, "scripts", "build-driver.sh")], {
    SIM_DEVICE_NAME: deviceName,
  });
  if (result.exitCode !== 0) {
    throw new XcuiError(`Driver build failed:\n${result.stderr || result.stdout}`);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Persistent daemon session
// ---------------------------------------------------------------------------

interface DaemonSession {
  child: ChildProcess;
  device: string;
  ready: Promise<void>;
  alive: boolean;
}

let session: DaemonSession | null = null;
let seq = 0;

// Serialize commands so concurrent tool calls don't clobber the shared command file.
let chain: Promise<unknown> = Promise.resolve();
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const result = chain.then(fn, fn);
  chain = result.then(
    () => undefined,
    () => undefined,
  );
  return result as Promise<T>;
}

async function waitForStatus(timeoutMs: number, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new XcuiError(
        `Daemon exited during startup (code ${child.exitCode}). See ${DAEMON_LOG}.`,
      );
    }
    try {
      const raw = await fs.readFile(STATUS_PATH, "utf8");
      const status = JSON.parse(raw) as { ready?: boolean };
      if (status.ready) return;
    } catch {
      /* not ready yet */
    }
    await sleep(POLL_MS);
  }
  throw new XcuiError(`Daemon did not become ready within ${timeoutMs}ms. See ${DAEMON_LOG}.`);
}

async function ensureSession(driver: DriverInfo, deviceName: string): Promise<DaemonSession> {
  if (session && session.alive && session.device === deviceName && session.child.exitCode === null) {
    await session.ready;
    return session;
  }

  // Tear down a stale/mismatched session.
  if (session) {
    try {
      session.child.kill("SIGTERM");
    } catch {
      /* ignore */
    }
    session = null;
  }

  await fs.mkdir(ACTIVE_DIR, { recursive: true });
  await Promise.all([
    fs.rm(STATUS_PATH, { force: true }),
    fs.rm(RESULT_PATH, { force: true }),
    fs.rm(COMMAND_PATH, { force: true }),
  ]);
  // Flag file tells the in-simulator test to enter daemon mode (env vars don't reach it).
  await fs.writeFile(DAEMON_FLAG, "1", "utf8");

  const logFd = openSync(DAEMON_LOG, "a");
  const child = spawn(
    "xcodebuild",
    [
      "test-without-building",
      "-xctestrun",
      driver.xctestrun,
      "-destination",
      `platform=iOS Simulator,name=${deviceName}`,
      "-only-testing:SimDriverUITests/DriverTests/testRunCommand",
    ],
    {
      env: { ...process.env, UI_TEST_DAEMON: "1" },
      stdio: ["ignore", logFd, logFd],
    },
  );

  const newSession: DaemonSession = {
    child,
    device: deviceName,
    alive: true,
    ready: waitForStatus(DAEMON_READY_TIMEOUT_MS, child),
  };
  child.on("exit", () => {
    newSession.alive = false;
    if (session === newSession) session = null;
  });
  session = newSession;

  try {
    await newSession.ready;
  } catch (err) {
    newSession.alive = false;
    session = null;
    throw err;
  }
  return newSession;
}

async function sendToDaemon(payload: UICommand): Promise<UIResult> {
  const mySeq = ++seq;
  await fs.writeFile(COMMAND_TMP, JSON.stringify({ seq: mySeq, command: payload }), "utf8");
  await fs.rename(COMMAND_TMP, COMMAND_PATH); // atomic publish

  const deadline = Date.now() + COMMAND_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (session && (!session.alive || session.child.exitCode !== null)) {
      throw new XcuiError(
        `Daemon exited while waiting for a result (code ${session.child.exitCode ?? "?"}). See ${DAEMON_LOG}.`,
      );
    }
    try {
      const raw = await fs.readFile(RESULT_PATH, "utf8");
      const env = JSON.parse(raw) as { seq: number; result: UIResult };
      if (env.seq === mySeq) return env.result;
    } catch {
      /* result not ready or mid-write */
    }
    await sleep(POLL_MS);
  }
  throw new XcuiError(`Command timed out after ${COMMAND_TIMEOUT_MS}ms.`);
}

/** Execute a fluid UI command against whatever app is on screen. */
export async function runUICommand(
  command: UICommand,
  opts: { bundleId?: string; device?: string } = {},
): Promise<UIResult> {
  const driver = await loadDriverInfo().catch(async () => {
    await buildDriver(opts.device ?? "iPhone 17 Pro");
    return loadDriverInfo();
  });

  const deviceName = opts.device && opts.device !== "booted" ? opts.device : driver.deviceName;
  await ensureSimulatorBooted(deviceName);

  const resolvedBundle = resolveBundleId(opts.bundleId ?? command.bundleId);
  const payload: UICommand = { ...command, bundleId: resolvedBundle };

  // simctl launch reliably switches apps from the host. XCUITest launch() inside the
  // daemon crashes the runner when another app is foreground — use simctl instead.
  if (resolvedBundle && resolvedBundle !== "com.apple.springboard") {
    await run("xcrun", ["simctl", "launch", deviceName, resolvedBundle]);
  }

  return withLock(async () => {
    // One retry: if the daemon died (idle timeout, sim restart), respawn and resend.
    for (let attempt = 0; attempt < 2; attempt++) {
      await ensureSession(driver, deviceName);
      try {
        const result = await sendToDaemon(payload);
        if (!result.success) throw new XcuiError(result.error ?? "UI command failed");
        return result;
      } catch (err) {
        const dead = !session || !session.alive;
        if (err instanceof XcuiError && dead && attempt === 0) {
          session = null;
          continue; // respawn and retry once
        }
        throw err;
      }
    }
    throw new XcuiError("UI command failed after daemon respawn.");
  });
}

/** Stop the persistent daemon if running (used on process exit). */
export function shutdownSession(): void {
  if (session) {
    try {
      session.child.kill("SIGTERM");
    } catch {
      /* ignore */
    }
    session = null;
  }
}

process.on("exit", shutdownSession);

/** Format describe results for the model — compact, no hardcoded app knowledge. */
export function formatDescribeResult(result: UIResult): string {
  const lines: string[] = [];
  if (result.bundleId) lines.push(`App: ${result.bundleId}`);
  if (result.screen) {
    lines.push(`Screen: ${result.screen.width}×${result.screen.height}`);
  }
  const elements = result.elements ?? [];
  lines.push(`Elements (${elements.length}):`);
  for (const el of elements) {
    const parts = [`[${el.index}] ${el.type}`];
    if (el.label) parts.push(`label="${el.label}"`);
    if (el.identifier) parts.push(`id="${el.identifier}"`);
    if (el.value) parts.push(`value="${el.value}"`);
    const f = el.frame;
    parts.push(`frame=(${Math.round(f.x)},${Math.round(f.y)},${Math.round(f.width)}×${Math.round(f.height)})`);
    if (el.hittable) parts.push("hittable");
    lines.push(parts.join(" "));
  }
  return lines.join("\n");
}
