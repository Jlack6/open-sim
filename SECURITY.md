# Security Policy

## Supported versions

open-sim is an early-stage project. Security fixes are applied to the latest release on the `main` branch only.

## Reporting a vulnerability

**Please do not report security issues in public GitHub issues, discussions, or pull requests.**

Instead, report privately using GitHub's [private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability):

1. Go to the repository's **Security** tab.
2. Click **Report a vulnerability**.
3. Describe the issue, steps to reproduce, and any potential impact.

I'll acknowledge receipt as soon as I can and work with you on a fix and disclosure timeline.

## Scope & expectations

open-sim runs locally on your machine and intentionally executes commands (`simctl`, `xcodebuild`, XCUITest) and automates the simulator UI on your behalf. Note that:

- The `run_simctl` tool is a deliberate escape hatch for running arbitrary `simctl` subcommands. Capabilities it exposes are inherent to `simctl`, not a vulnerability in open-sim.
- open-sim is driven by an AI agent that decides which tools to call. Treat the agent's actions as you would any automation with access to your developer environment, and only point it at apps and data you're authorized to use.

Reports that highlight unexpected command execution beyond the documented tool surface, path/argument injection, or unsafe handling of untrusted input are especially appreciated.
