/**
 * @kaitox/relay-protocol — the wire contract between kaitox upload clients
 * (CLI, Obsidian, your own service) and a kaitox relay, plus a portable
 * fetch-based client.
 *
 * Layering rule: this package never imports from any other kaitox package.
 * Feature engines (e.g. @kaitox/x-article) and the relay server both depend
 * on it, never the other way around.
 *
 *   - bundle.ts       DraftBundle data contract (what travels over the wire)
 *   - relayClient.ts  RelayClient interface + HttpRelayClient (Node & browser)
 *   - validate.ts     zero-dep wire validators (the executable form of the contract)
 *   - base64.ts       byte <-> base64 helpers (Buffer or atob/btoa)
 */

export type {
  DraftBundle,
  DraftAsset,
  DraftListItem,
  DraftKind,
  DraftMode,
  DraftSource,
  DraftStatus,
  StyleIssue,
  StyleReport,
} from './bundle.js';
export {
  DEFAULT_DRAFT_KIND,
  draftKind,
  SCHEMA_VERSION,
  bundleSchemaVersion,
} from './bundle.js';
export {
  HttpRelayClient,
  RelayHttpError,
  DEFAULT_RELAY_PORT,
  DEFAULT_RELAY_BASE,
} from './relayClient.js';
export {
  validatePostDraftWireBody,
  validateSetCoverWireBody,
  validateAckPatch,
  validateSettingPatch,
  isValidKindSegment,
  RESERVED_KIND_SEGMENTS,
} from './validate.js';
export type { WireIssue, WireResult, AckPatch, SettingPatch } from './validate.js';
export type {
  RelayClient,
  PostDraftInput,
  DraftAssetInput,
  SetCoverInput,
  PostDraftWireBody,
  SetCoverWireBody,
  HttpRelayClientOptions,
} from './relayClient.js';
export { bytesToBase64, base64ToBytes } from './base64.js';
