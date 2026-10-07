// Entry for the separately built claude-sdk.cjs bundle. main.js never imports
// the SDK at runtime; claude-sdk-port.ts requires this bundle on first use.
export { forkSession, query } from "@anthropic-ai/claude-agent-sdk";
