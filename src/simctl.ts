import { execFile } from "node:child_process";

const DEFAULT_TIMEOUT_MS = 8_000;

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export class SimctlError extends Error {
  constructor(
    message: string,
    public readonly result: RunResult,
    public readonly command: string,
  ) {
    super(message);
    this.name = "SimctlError";
  }
}

/**
 * Run an arbitrary command, capturing stdout/stderr. Uses execFile (no shell)
 * so arguments are passed literally and are not subject to shell injection.
 */
export function run(
  command: string,
  args: string[],
  opts: { timeoutMs?: number; input?: string; encoding?: "utf8" | "buffer" } = {},
): Promise<RunResult> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, input } = opts;
  return new Promise((resolve, reject) => {
    const child = execFile(
      command,
      args,
      { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, encoding: "buffer" },
      (error, stdout, stderr) => {
        const result: RunResult = {
          stdout: stdout.toString("utf8"),
          stderr: stderr.toString("utf8"),
          exitCode: error && typeof (error as NodeJS.ErrnoException).code === "number"
            ? ((error as unknown as { code: number }).code)
            : error
              ? 1
              : 0,
        };
        if (error && (error as NodeJS.ErrnoException).code === "ENOENT") {
          reject(
            new SimctlError(
              `Command not found: ${command}. Is Xcode / command line tools installed?`,
              result,
              `${command} ${args.join(" ")}`,
            ),
          );
          return;
        }
        if (error && (error as { killed?: boolean }).killed) {
          reject(
            new SimctlError(
              `Command timed out after ${timeoutMs}ms`,
              result,
              `${command} ${args.join(" ")}`,
            ),
          );
          return;
        }
        resolve(result);
      },
    );
    if (input !== undefined && child.stdin) {
      child.stdin.write(input);
      child.stdin.end();
    }
  });
}

/** Run `xcrun simctl <args...>`. */
export function simctl(
  args: string[],
  opts?: { timeoutMs?: number; input?: string },
): Promise<RunResult> {
  return run("xcrun", ["simctl", ...args], opts);
}

/**
 * Run a simctl command and throw a descriptive error on non-zero exit so the
 * MCP layer can surface it as an error to the model.
 */
export async function simctlChecked(
  args: string[],
  opts?: { timeoutMs?: number; input?: string },
): Promise<RunResult> {
  const result = await simctl(args, opts);
  if (result.exitCode !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || "(no output)";
    throw new SimctlError(
      `simctl ${args.join(" ")} failed (exit ${result.exitCode}): ${detail}`,
      result,
      `xcrun simctl ${args.join(" ")}`,
    );
  }
  return result;
}

/** Capture raw bytes from a command (used for screenshots). */
export function runBinary(
  command: string,
  args: string[],
  opts: { timeoutMs?: number } = {},
): Promise<{ data: Buffer; stderr: string; exitCode: number }> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS } = opts;
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      { timeout: timeoutMs, maxBuffer: 256 * 1024 * 1024, encoding: "buffer" },
      (error, stdout, stderr) => {
        if (error && (error as NodeJS.ErrnoException).code === "ENOENT") {
          reject(new Error(`Command not found: ${command}`));
          return;
        }
        resolve({
          data: stdout as unknown as Buffer,
          stderr: (stderr as unknown as Buffer).toString("utf8"),
          exitCode: error ? ((error as unknown as { code?: number }).code ?? 1) : 0,
        });
      },
    );
  });
}
