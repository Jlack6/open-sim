#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { execPath } from "node:process";
import { run, runBinary, simctl, simctlChecked, SimctlError } from "./simctl.js";
import { setLastBundleId } from "./session.js";
import {
  formatDescribeResult,
  runUICommand,
  XcuiError,
  type ElementQuery,
  type UICommand,
} from "./xcui.js";

// Cursor (a GUI app) often launches MCP servers with a minimal PATH that omits
// Homebrew and the dir holding `node`. Ensure child tools (xcrun, xcodebuild, bash,
// node) always resolve regardless of how the server was started.
function hardenPath(): void {
  const required = [
    dirname(execPath), // wherever this node binary lives
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
    "/opt/homebrew/bin",
    "/usr/local/bin",
  ];
  const current = (process.env.PATH ?? "").split(":").filter(Boolean);
  const merged = [...current];
  for (const dir of required) {
    if (!merged.includes(dir)) merged.push(dir);
  }
  process.env.PATH = merged.join(":");
}
hardenPath();

const server = new McpServer({
  name: "open-sim",
  version: "0.2.0",
});

const elementQuerySchema = {
  label: z.string().optional().describe("Exact accessibility label match."),
  labelContains: z.string().optional().describe("Case-insensitive label substring — use what you see on screen."),
  identifier: z.string().optional().describe("Accessibility identifier, if present."),
  valueContains: z.string().optional().describe("Substring match on element value."),
  type: z
    .string()
    .optional()
    .describe('Element type: button, textField, cell, switch, staticText, image, tabBar, etc.'),
  index: z.number().int().optional().describe("Pick the Nth match (0-based) when several elements match."),
};

function toQuery(q: {
  label?: string;
  labelContains?: string;
  identifier?: string;
  valueContains?: string;
  type?: string;
  index?: number;
}): ElementQuery | undefined {
  if (!q.label && !q.labelContains && !q.identifier && !q.valueContains && !q.type && q.index === undefined) {
    return undefined;
  }
  return q;
}

type ToolResult = {
  content: Array<
    | { type: "text"; text: string }
    | { type: "image"; data: string; mimeType: string }
  >;
  isError?: boolean;
};

function text(value: string): ToolResult {
  return { content: [{ type: "text", text: value }] };
}

function errorResult(err: unknown): ToolResult {
  const message =
    err instanceof SimctlError || err instanceof XcuiError
      ? err.message
      : err instanceof Error
        ? err.message
        : String(err);
  return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
}

/** Wrap a tool handler so thrown errors become MCP error results. */
function tool(handler: () => Promise<ToolResult>): Promise<ToolResult> {
  return handler().catch(errorResult);
}

const deviceArg = z
  .string()
  .optional()
  .describe(
    'Target device: a UDID, a device name (e.g. "iPhone 16"), or "booted" for the currently running simulator. Defaults to "booted".',
  );

function device(value?: string): string {
  return value && value.trim() ? value.trim() : "booted";
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

server.registerTool(
  "list_devices",
  {
    title: "List simulators",
    description:
      "List iOS Simulator devices and their state (Booted/Shutdown), with UDIDs. Set availableOnly to hide unavailable devices.",
    inputSchema: {
      availableOnly: z.boolean().optional().describe("Only list available devices."),
      search: z.string().optional().describe('Filter term, e.g. "iPhone".'),
    },
  },
  async ({ availableOnly, search }) =>
    tool(async () => {
      const args = ["list", "devices", "--json"];
      if (search) args.push(search);
      if (availableOnly) args.push("available");
      const { stdout } = await simctlChecked(args);
      return text(stdout.trim());
    }),
);

server.registerTool(
  "list_device_types",
  {
    title: "List device types",
    description: "List the simulator device types available for creating new simulators.",
    inputSchema: {},
  },
  async () =>
    tool(async () => {
      const { stdout } = await simctlChecked(["list", "devicetypes", "--json"]);
      return text(stdout.trim());
    }),
);

server.registerTool(
  "list_runtimes",
  {
    title: "List runtimes",
    description: "List the installed iOS/watchOS/tvOS runtimes (OS versions) available to simulators.",
    inputSchema: {},
  },
  async () =>
    tool(async () => {
      const { stdout } = await simctlChecked(["list", "runtimes", "--json"]);
      return text(stdout.trim());
    }),
);

// ---------------------------------------------------------------------------
// Device lifecycle
// ---------------------------------------------------------------------------

server.registerTool(
  "boot_device",
  {
    title: "Boot simulator",
    description:
      "Boot a simulator by UDID or name. Does not open the Simulator app window; use open_simulator for the GUI.",
    inputSchema: { device: deviceArg },
  },
  async ({ device: d }) =>
    tool(async () => {
      const result = await simctl(["boot", device(d)]);
      // "Unable to boot device in current state: Booted" is harmless.
      if (result.exitCode !== 0 && !/current state: Booted/i.test(result.stderr)) {
        throw new SimctlError(
          `boot failed: ${result.stderr.trim() || result.stdout.trim()}`,
          result,
          "boot",
        );
      }
      return text(`Booted ${device(d)}.`);
    }),
);

server.registerTool(
  "shutdown_device",
  {
    title: "Shutdown simulator",
    description: 'Shut down a simulator. Pass "all" to shut down every running simulator.',
    inputSchema: { device: deviceArg },
  },
  async ({ device: d }) =>
    tool(async () => {
      await simctlChecked(["shutdown", device(d)]);
      return text(`Shut down ${device(d)}.`);
    }),
);

server.registerTool(
  "open_simulator",
  {
    title: "Open Simulator app",
    description:
      "Open the Simulator GUI application so you can see the screen. Optionally focus a specific device UDID.",
    inputSchema: {
      udid: z.string().optional().describe("UDID to focus the Simulator window on."),
    },
  },
  async ({ udid }) =>
    tool(async () => {
      const args = ["-a", "Simulator"];
      if (udid) args.push("--args", "-CurrentDeviceUDID", udid);
      const result = await run("open", args);
      if (result.exitCode !== 0) {
        throw new Error(result.stderr.trim() || "Failed to open Simulator app");
      }
      return text("Opened Simulator app.");
    }),
);

server.registerTool(
  "create_device",
  {
    title: "Create simulator",
    description:
      "Create a new simulator. deviceTypeId and runtimeId can be names or identifiers from list_device_types / list_runtimes.",
    inputSchema: {
      name: z.string().describe('Name for the new simulator, e.g. "My iPhone".'),
      deviceTypeId: z.string().describe('Device type, e.g. "iPhone 16".'),
      runtimeId: z.string().optional().describe('Runtime, e.g. "iOS 18.2". Defaults to newest compatible.'),
    },
  },
  async ({ name, deviceTypeId, runtimeId }) =>
    tool(async () => {
      const args = ["create", name, deviceTypeId];
      if (runtimeId) args.push(runtimeId);
      const { stdout } = await simctlChecked(args);
      return text(`Created simulator "${name}" (UDID: ${stdout.trim()}).`);
    }),
);

server.registerTool(
  "delete_device",
  {
    title: "Delete simulator",
    description: 'Delete a simulator by UDID/name. Pass "all" to delete all, or "unavailable" to prune.',
    inputSchema: { device: z.string().describe('UDID, name, "all", or "unavailable".') },
  },
  async ({ device: d }) =>
    tool(async () => {
      await simctlChecked(["delete", d]);
      return text(`Deleted ${d}.`);
    }),
);

server.registerTool(
  "erase_device",
  {
    title: "Erase simulator",
    description: 'Erase a simulator\'s contents and settings (factory reset). Pass "all" to erase all.',
    inputSchema: { device: deviceArg },
  },
  async ({ device: d }) =>
    tool(async () => {
      await simctlChecked(["erase", device(d)]);
      return text(`Erased ${device(d)}.`);
    }),
);

server.registerTool(
  "rename_device",
  {
    title: "Rename simulator",
    description: "Rename a simulator.",
    inputSchema: {
      device: z.string().describe("UDID or current name."),
      name: z.string().describe("New name."),
    },
  },
  async ({ device: d, name }) =>
    tool(async () => {
      await simctlChecked(["rename", d, name]);
      return text(`Renamed to "${name}".`);
    }),
);

// ---------------------------------------------------------------------------
// Apps
// ---------------------------------------------------------------------------

server.registerTool(
  "install_app",
  {
    title: "Install app",
    description: "Install an .app bundle (or .ipa) onto a simulator from a local path.",
    inputSchema: {
      device: deviceArg,
      path: z.string().describe("Absolute path to the .app or .ipa."),
    },
  },
  async ({ device: d, path }) =>
    tool(async () => {
      await simctlChecked(["install", device(d), path], { timeoutMs: 120_000 });
      return text(`Installed ${path}.`);
    }),
);

server.registerTool(
  "uninstall_app",
  {
    title: "Uninstall app",
    description: "Uninstall an app from a simulator by bundle identifier.",
    inputSchema: {
      device: deviceArg,
      bundleId: z.string().describe('Bundle identifier, e.g. "com.example.MyApp".'),
    },
  },
  async ({ device: d, bundleId }) =>
    tool(async () => {
      await simctlChecked(["uninstall", device(d), bundleId]);
      return text(`Uninstalled ${bundleId}.`);
    }),
);

server.registerTool(
  "launch_app",
  {
    title: "Launch app",
    description: "Launch an installed app by bundle identifier, optionally passing launch arguments.",
    inputSchema: {
      device: deviceArg,
      bundleId: z.string().describe("Bundle identifier to launch."),
      args: z.array(z.string()).optional().describe("Launch arguments passed to the app."),
      terminateExisting: z
        .boolean()
        .optional()
        .describe("Terminate a running copy before launching."),
    },
  },
  async ({ device: d, bundleId, args, terminateExisting }) =>
    tool(async () => {
      const cmd = ["launch"];
      if (terminateExisting) cmd.push("--terminate-running-process");
      cmd.push(device(d), bundleId, ...(args ?? []));
      const { stdout } = await simctlChecked(cmd);
      setLastBundleId(bundleId);
      return text(stdout.trim() || `Launched ${bundleId}.`);
    }),
);

server.registerTool(
  "terminate_app",
  {
    title: "Terminate app",
    description: "Terminate a running app on a simulator by bundle identifier.",
    inputSchema: {
      device: deviceArg,
      bundleId: z.string().describe("Bundle identifier to terminate."),
    },
  },
  async ({ device: d, bundleId }) =>
    tool(async () => {
      await simctlChecked(["terminate", device(d), bundleId]);
      return text(`Terminated ${bundleId}.`);
    }),
);

server.registerTool(
  "list_apps",
  {
    title: "List installed apps",
    description: "List apps installed on a simulator (raw plist-style output).",
    inputSchema: { device: deviceArg },
  },
  async ({ device: d }) =>
    tool(async () => {
      const { stdout } = await simctlChecked(["listapps", device(d)]);
      return text(stdout.trim() || "(no apps)");
    }),
);

server.registerTool(
  "open_url",
  {
    title: "Open URL / deep link",
    description: "Open a URL on the simulator. Use https:// for Safari or a custom scheme for deep links.",
    inputSchema: {
      device: deviceArg,
      url: z.string().describe('URL to open, e.g. "https://apple.com" or "myapp://path".'),
    },
  },
  async ({ device: d, url }) =>
    tool(async () => {
      await simctlChecked(["openurl", device(d), url]);
      return text(`Opened ${url}.`);
    }),
);

server.registerTool(
  "get_app_container",
  {
    title: "Get app container path",
    description: "Print the filesystem path of an installed app's container on the host.",
    inputSchema: {
      device: deviceArg,
      bundleId: z.string().describe("Bundle identifier."),
      container: z
        .enum(["app", "data", "groups"])
        .optional()
        .describe("Which container to resolve. Defaults to app."),
    },
  },
  async ({ device: d, bundleId, container }) =>
    tool(async () => {
      const args = ["get_app_container", device(d), bundleId];
      if (container) args.push(container);
      const { stdout } = await simctlChecked(args);
      return text(stdout.trim());
    }),
);

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

server.registerTool(
  "screenshot",
  {
    title: "Screenshot",
    description:
      "Capture a screenshot of the simulator screen and return it as an image so you can see the current UI.",
    inputSchema: {
      device: deviceArg,
      savePath: z
        .string()
        .optional()
        .describe("Optional absolute path to also save the PNG on disk."),
    },
  },
  async ({ device: d, savePath }) =>
    tool(async () => {
      const { data, stderr, exitCode } = await runBinary("xcrun", [
        "simctl",
        "io",
        device(d),
        "screenshot",
        "-",
      ]);
      if (exitCode !== 0 || data.length === 0) {
        throw new Error(stderr.trim() || "screenshot failed");
      }
      if (savePath) await fs.writeFile(savePath, data);
      return {
        content: [
          { type: "text", text: savePath ? `Saved screenshot to ${savePath}.` : "Screenshot captured." },
          { type: "image", data: data.toString("base64"), mimeType: "image/png" },
        ],
      };
    }),
);

// ---------------------------------------------------------------------------
// Location
// ---------------------------------------------------------------------------

server.registerTool(
  "set_location",
  {
    title: "Set GPS location",
    description: "Set the simulated GPS coordinate for a simulator.",
    inputSchema: {
      device: deviceArg,
      latitude: z.number().describe("Latitude in decimal degrees."),
      longitude: z.number().describe("Longitude in decimal degrees."),
    },
  },
  async ({ device: d, latitude, longitude }) =>
    tool(async () => {
      await simctlChecked(["location", device(d), "set", `${latitude},${longitude}`]);
      return text(`Set location to ${latitude}, ${longitude}.`);
    }),
);

server.registerTool(
  "clear_location",
  {
    title: "Clear GPS location",
    description: "Stop any simulated location scenario and clear the simulated location.",
    inputSchema: { device: deviceArg },
  },
  async ({ device: d }) =>
    tool(async () => {
      await simctlChecked(["location", device(d), "clear"]);
      return text("Cleared simulated location.");
    }),
);

// ---------------------------------------------------------------------------
// Privacy / permissions
// ---------------------------------------------------------------------------

const privacyService = z.enum([
  "all",
  "calendar",
  "contacts-limited",
  "contacts",
  "location",
  "location-always",
  "photos-add",
  "photos",
  "media-library",
  "microphone",
  "motion",
  "reminders",
  "siri",
]);

server.registerTool(
  "set_privacy",
  {
    title: "Set app permission",
    description:
      "Grant, revoke, or reset a privacy permission for an app without prompting (e.g. photos, location, microphone).",
    inputSchema: {
      device: deviceArg,
      action: z.enum(["grant", "revoke", "reset"]).describe("What to do with the permission."),
      service: privacyService.describe("The privacy service to change."),
      bundleId: z
        .string()
        .optional()
        .describe("Bundle identifier. Required for grant/revoke; optional for reset."),
    },
  },
  async ({ device: d, action, service, bundleId }) =>
    tool(async () => {
      if ((action === "grant" || action === "revoke") && !bundleId) {
        throw new Error(`bundleId is required for action "${action}".`);
      }
      const args = ["privacy", device(d), action, service];
      if (bundleId) args.push(bundleId);
      await simctlChecked(args);
      return text(`${action} ${service}${bundleId ? ` for ${bundleId}` : ""}.`);
    }),
);

// ---------------------------------------------------------------------------
// UI appearance
// ---------------------------------------------------------------------------

server.registerTool(
  "set_appearance",
  {
    title: "Set light/dark mode",
    description: "Switch the simulator UI between light and dark appearance.",
    inputSchema: {
      device: deviceArg,
      style: z.enum(["light", "dark"]).describe("Appearance style."),
    },
  },
  async ({ device: d, style }) =>
    tool(async () => {
      await simctlChecked(["ui", device(d), "appearance", style]);
      return text(`Set appearance to ${style}.`);
    }),
);

server.registerTool(
  "set_content_size",
  {
    title: "Set Dynamic Type size",
    description: "Set the preferred content size (Dynamic Type) category for accessibility testing.",
    inputSchema: {
      device: deviceArg,
      size: z
        .enum([
          "extra-small",
          "small",
          "medium",
          "large",
          "extra-large",
          "extra-extra-large",
          "extra-extra-extra-large",
          "accessibility-medium",
          "accessibility-large",
          "accessibility-extra-large",
          "accessibility-extra-extra-large",
          "accessibility-extra-extra-extra-large",
          "increment",
          "decrement",
        ])
        .describe("Content size category, or increment/decrement."),
    },
  },
  async ({ device: d, size }) =>
    tool(async () => {
      await simctlChecked(["ui", device(d), "content_size", size]);
      return text(`Set content size to ${size}.`);
    }),
);

// ---------------------------------------------------------------------------
// Status bar
// ---------------------------------------------------------------------------

server.registerTool(
  "set_status_bar",
  {
    title: "Override status bar",
    description:
      "Override status bar values for clean screenshots (time, battery, signal, carrier). Provide at least one field.",
    inputSchema: {
      device: deviceArg,
      time: z.string().optional().describe('Time/date string, e.g. "9:41" or an ISO date.'),
      dataNetwork: z
        .enum(["hide", "wifi", "3g", "4g", "lte", "lte-a", "lte+", "5g", "5g+", "5g-uwb", "5g-uc"])
        .optional(),
      wifiBars: z.number().int().min(0).max(3).optional(),
      cellularBars: z.number().int().min(0).max(4).optional(),
      operatorName: z.string().optional().describe("Carrier name."),
      batteryState: z.enum(["charging", "charged", "discharging"]).optional(),
      batteryLevel: z.number().int().min(0).max(100).optional(),
    },
  },
  async ({ device: d, time, dataNetwork, wifiBars, cellularBars, operatorName, batteryState, batteryLevel }) =>
    tool(async () => {
      const args = ["status_bar", device(d), "override"];
      if (time !== undefined) args.push("--time", time);
      if (dataNetwork !== undefined) args.push("--dataNetwork", dataNetwork);
      if (wifiBars !== undefined) args.push("--wifiBars", String(wifiBars));
      if (cellularBars !== undefined) args.push("--cellularBars", String(cellularBars));
      if (operatorName !== undefined) args.push("--operatorName", operatorName);
      if (batteryState !== undefined) args.push("--batteryState", batteryState);
      if (batteryLevel !== undefined) args.push("--batteryLevel", String(batteryLevel));
      if (args.length === 3) throw new Error("Provide at least one status bar field to override.");
      await simctlChecked(args);
      return text("Status bar overridden.");
    }),
);

server.registerTool(
  "clear_status_bar",
  {
    title: "Clear status bar overrides",
    description: "Remove all status bar overrides.",
    inputSchema: { device: deviceArg },
  },
  async ({ device: d }) =>
    tool(async () => {
      await simctlChecked(["status_bar", device(d), "clear"]);
      return text("Cleared status bar overrides.");
    }),
);

// ---------------------------------------------------------------------------
// Push notifications
// ---------------------------------------------------------------------------

server.registerTool(
  "push_notification",
  {
    title: "Send push notification",
    description:
      "Send a simulated APNs push notification to an app. Provide the APNs payload as a JSON object containing an 'aps' key.",
    inputSchema: {
      device: deviceArg,
      bundleId: z.string().describe("Target app bundle identifier."),
      payload: z
        .record(z.any())
        .describe('APNs payload object, e.g. {"aps":{"alert":"Hello","badge":1}}.'),
    },
  },
  async ({ device: d, bundleId, payload }) =>
    tool(async () => {
      const file = join(tmpdir(), `open-sim-push-${randomUUID()}.json`);
      await fs.writeFile(file, JSON.stringify(payload), "utf8");
      try {
        await simctlChecked(["push", device(d), bundleId, file]);
      } finally {
        await fs.rm(file, { force: true });
      }
      return text(`Pushed notification to ${bundleId}.`);
    }),
);

// ---------------------------------------------------------------------------
// Media & pasteboard
// ---------------------------------------------------------------------------

server.registerTool(
  "add_media",
  {
    title: "Add media",
    description: "Add photos, videos, or contacts (vCard) to a simulator from local file paths.",
    inputSchema: {
      device: deviceArg,
      paths: z.array(z.string()).min(1).describe("Absolute paths to media/contact files."),
    },
  },
  async ({ device: d, paths }) =>
    tool(async () => {
      await simctlChecked(["addmedia", device(d), ...paths]);
      return text(`Added ${paths.length} item(s) to the library.`);
    }),
);

server.registerTool(
  "set_pasteboard",
  {
    title: "Set clipboard",
    description: "Set the simulator's clipboard (pasteboard) contents to the given text.",
    inputSchema: {
      device: deviceArg,
      text: z.string().describe("Text to copy onto the simulator clipboard."),
    },
  },
  async ({ device: d, text: value }) =>
    tool(async () => {
      const result = await simctl(["pbcopy", device(d)], { input: value });
      if (result.exitCode !== 0) {
        throw new SimctlError(result.stderr.trim() || "pbcopy failed", result, "pbcopy");
      }
      return text("Clipboard set.");
    }),
);

server.registerTool(
  "get_pasteboard",
  {
    title: "Get clipboard",
    description: "Read the simulator's clipboard (pasteboard) contents.",
    inputSchema: { device: deviceArg },
  },
  async ({ device: d }) =>
    tool(async () => {
      const { stdout } = await simctlChecked(["pbpaste", device(d)]);
      return text(stdout);
    }),
);

// ---------------------------------------------------------------------------
// In-app UI (XCUITest — fluid, works with any app, no hardcoded labels)
// ---------------------------------------------------------------------------

const bundleIdArg = z
  .string()
  .optional()
  .describe(
    "App bundle ID. Omit to use the last launched app, or the home screen if none.",
  );

server.registerTool(
  "describe_ui",
  {
    title: "Describe on-screen UI",
    description:
      "Return the accessibility tree of whatever is on screen — labels, types, frames, hittable state. " +
      "Use this to decide what to tap or type. No hardcoded app knowledge required.",
    inputSchema: {
      device: deviceArg,
      bundleId: bundleIdArg,
    },
  },
  async ({ device: d, bundleId }) =>
    tool(async () => {
      const result = await runUICommand({ action: "describe" }, { bundleId, device: d });
      return text(formatDescribeResult(result));
    }),
);

server.registerTool(
  "ui_tap",
  {
    title: "Tap on screen",
    description:
      "Tap an element or coordinate. Use describe_ui first, then tap by labelContains/query or by x/y. " +
      "Coordinates are normalized 0–1 by default (relative to screen size).",
    inputSchema: {
      device: deviceArg,
      bundleId: bundleIdArg,
      ...elementQuerySchema,
      x: z.number().optional().describe("X coordinate (pixels if normalized=false, else 0–1)."),
      y: z.number().optional().describe("Y coordinate (pixels if normalized=false, else 0–1)."),
      normalized: z.boolean().optional().describe("Treat x/y as 0–1 fractions of screen size. Default true."),
    },
  },
  async (params) =>
    tool(async () => {
      const { device: d, bundleId, x, y, normalized, ...rest } = params;
      const result = await runUICommand(
        {
          action: "tap",
          query: toQuery(rest),
          x,
          y,
          normalized: normalized ?? (x !== undefined ? true : undefined),
        },
        { bundleId, device: d },
      );
      const msg = result.matched
        ? `Tapped ${result.matched.type}${result.matched.label ? ` "${result.matched.label}"` : ""}.`
        : x !== undefined
          ? `Tapped (${x}, ${y}).`
          : "Tapped.";
      return text(msg);
    }),
);

server.registerTool(
  "ui_swipe",
  {
    title: "Swipe on screen",
    description: "Swipe up/down/left/right on the current screen, or drag between two coordinate pairs.",
    inputSchema: {
      device: deviceArg,
      bundleId: bundleIdArg,
      direction: z.enum(["up", "down", "left", "right"]).optional(),
      fromX: z.number().optional(),
      fromY: z.number().optional(),
      toX: z.number().optional(),
      toY: z.number().optional(),
      normalized: z.boolean().optional().describe("Normalize coordinate pairs to 0–1. Default true."),
      ...elementQuerySchema,
    },
  },
  async (params) =>
    tool(async () => {
      const { device: d, bundleId, direction, fromX, fromY, toX, toY, normalized, ...rest } = params;
      await runUICommand(
        {
          action: "swipe",
          direction,
          fromX,
          fromY,
          toX,
          toY,
          normalized: normalized ?? true,
          query: toQuery(rest),
        },
        { bundleId, device: d },
      );
      return text(direction ? `Swiped ${direction}.` : "Swiped.");
    }),
);

server.registerTool(
  "ui_type",
  {
    title: "Type text",
    description:
      "Type into a focused field, or tap a field first via query/coordinates. Works with any app's text inputs.",
    inputSchema: {
      device: deviceArg,
      bundleId: bundleIdArg,
      text: z.string().describe("Text to type."),
      ...elementQuerySchema,
      x: z.number().optional().describe("Tap here first to focus (normalized 0–1 by default)."),
      y: z.number().optional(),
      normalized: z.boolean().optional(),
    },
  },
  async (params) =>
    tool(async () => {
      const { device: d, bundleId, text: value, x, y, normalized, ...rest } = params;
      await runUICommand(
        {
          action: "type",
          text: value,
          query: toQuery(rest),
          x,
          y,
          normalized: normalized ?? (x !== undefined ? true : undefined),
        },
        { bundleId, device: d },
      );
      return text(`Typed "${value}".`);
    }),
);

server.registerTool(
  "ui_long_press",
  {
    title: "Long press",
    description: "Long-press an element or coordinate.",
    inputSchema: {
      device: deviceArg,
      bundleId: bundleIdArg,
      duration: z.number().optional().describe("Seconds to hold. Default 1."),
      ...elementQuerySchema,
      x: z.number().optional(),
      y: z.number().optional(),
      normalized: z.boolean().optional(),
    },
  },
  async (params) =>
    tool(async () => {
      const { device: d, bundleId, duration, x, y, normalized, ...rest } = params;
      await runUICommand(
        {
          action: "longPress",
          duration,
          query: toQuery(rest),
          x,
          y,
          normalized: normalized ?? (x !== undefined ? true : undefined),
        },
        { bundleId, device: d },
      );
      return text("Long pressed.");
    }),
);

server.registerTool(
  "ui_wait",
  {
    title: "Wait",
    description: "Pause for animations or loading to finish.",
    inputSchema: {
      device: deviceArg,
      seconds: z.number().min(0).max(30).describe("Seconds to wait."),
    },
  },
  async ({ device: d, seconds }) =>
    tool(async () => {
      await runUICommand({ action: "wait", timeout: seconds }, { device: d });
      return text(`Waited ${seconds}s.`);
    }),
);

server.registerTool(
  "ui_act",
  {
    title: "Run UI action sequence",
    description:
      "Run multiple UI actions in one XCUITest session — faster than separate calls. " +
      "Each step is a generic action (tap, type, swipe, wait, describe) with the same fluid targeting.",
    inputSchema: {
      device: deviceArg,
      bundleId: bundleIdArg,
      steps: z
        .array(
          z.object({
            action: z.enum(["tap", "type", "swipe", "longPress", "wait"]),
            text: z.string().optional(),
            direction: z.enum(["up", "down", "left", "right"]).optional(),
            duration: z.number().optional(),
            timeout: z.number().optional(),
            labelContains: z.string().optional(),
            label: z.string().optional(),
            type: z.string().optional(),
            x: z.number().optional(),
            y: z.number().optional(),
            normalized: z.boolean().optional(),
          }),
        )
        .min(1)
        .max(20),
    },
  },
  async ({ device: d, bundleId, steps }) =>
    tool(async () => {
      const actions: UICommand[] = steps.map((s) => ({
        action: s.action,
        text: s.text,
        direction: s.direction,
        duration: s.duration,
        timeout: s.timeout ?? s.duration,
        x: s.x,
        y: s.y,
        normalized: s.normalized ?? (s.x !== undefined && s.x <= 1 && s.y !== undefined && s.y <= 1 ? true : false),
        query: toQuery({
          label: s.label,
          labelContains: s.labelContains,
          type: s.type,
        }),
      }));
      await runUICommand({ action: "script", actions }, { bundleId, device: d });
      return text(`Completed ${steps.length} UI step(s).`);
    }),
);

// ---------------------------------------------------------------------------
// Escape hatch
// ---------------------------------------------------------------------------

server.registerTool(
  "run_simctl",
  {
    title: "Run raw simctl command",
    description:
      "Escape hatch: run an arbitrary `xcrun simctl` command with the given argument array. Use for anything not covered by a dedicated tool.",
    inputSchema: {
      args: z
        .array(z.string())
        .min(1)
        .describe('Arguments after "simctl", e.g. ["list","runtimes"] or ["ui","booted","appearance","dark"].'),
    },
  },
  async ({ args }) =>
    tool(async () => {
      const { stdout, stderr, exitCode } = await simctl(args);
      const out = [stdout.trim(), stderr.trim()].filter(Boolean).join("\n");
      return text(`exit ${exitCode}\n${out || "(no output)"}`);
    }),
);

async function main(): Promise<void> {
  // A single failing tool call (e.g. a hung xcodebuild) must never crash the
  // whole server, or Cursor marks it "errored". Log and keep serving.
  process.on("unhandledRejection", (reason) => {
    process.stderr.write(`unhandledRejection: ${String(reason)}\n`);
  });
  process.on("uncaughtException", (err) => {
    process.stderr.write(`uncaughtException: ${err instanceof Error ? err.stack : String(err)}\n`);
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stderr is safe for logging; stdout is reserved for the MCP protocol.
  process.stderr.write("open-sim MCP server running on stdio\n");
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});
