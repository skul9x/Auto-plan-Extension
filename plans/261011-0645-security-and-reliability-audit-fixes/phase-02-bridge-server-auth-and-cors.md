# Phase 02: Localhost HTTP Bridge Security & Session Token Authentication

Status: ✅ Completed
Dependencies: phase-01-secrets-hardening-and-storage.md

## Objective
Harden the embedded loopback HTTP bridge server (`BridgeServer`) against Cross-Origin IDE Hijacking and unauthorized command execution. Replace wildcard CORS with strict origin validation, generate a cryptographically strong ephemeral session authentication token on server startup, and mandate token validation on all mutating and sensitive endpoints.

## Requirements
### Functional
- [x] Implement Session Token Generation in `src/bridgeServer.ts`:
  - Generate a secure random 32-byte hexadecimal token (`crypto.randomBytes(32).toString('hex')`) upon server start.
  - Provide getter `getAuthToken(): string`.
  - Export the auth token into the sidecar configuration (`autoplan-config.json`) so the in-process DOM bridge script can read it.
- [x] Strict CORS & Origin Enforcement in `src/bridgeServer.ts`:
  - Remove wildcard `res.setHeader('Access-Control-Allow-Origin', '*')`.
  - Inspect incoming `req.headers['origin']`.
  - If `origin` is present, only allow approved internal schemes (`vscode-file://`, `vscode-webview://`). Reject any public web origins (`http://`, `https://`) with `403 Forbidden`.
  - If no `origin` header is present (direct desktop loopback client), allow the connection if remoteAddress is loopback.
- [x] Request Authentication Middleware in `src/bridgeServer.ts`:
  - Check request headers for `x-bridge-auth` or `authorization: Bearer <token>`.
  - Enforce token verification for `/autoplan-command`, `/autoplan-ack`, `/autoplan-log`, and state retrieval.
  - Reject unauthenticated or invalid token requests with `401 Unauthorized`.
  - Allow discovery probes on `/autoplan-status?probe=1` only if originating from loopback without exposing sensitive command execution.
- [x] Update `media/autoplan-dom-bridge.js`:
  - Read `authToken` from sidecar configuration during initialization.
  - Include `X-Bridge-Auth: <authToken>` header in all fetch requests (`/autoplan-status`, `/autoplan-log`, `/autoplan-ack`).

### Non-Functional
- [x] Security: Prevent external browser tabs from discovering the bridge or dispatching arbitrary prompts to Antigravity IDE.
- [x] Performance: Token validation overhead must remain sub-millisecond (< 0.1ms).

## Files to Create/Modify
- `src/bridgeServer.ts` - Implement token generation, origin validation, and auth verification.
- `src/config.ts` - Pass `bridgeAuthToken` to `writeSidecarConfig`.
- `media/autoplan-dom-bridge.js` - Inject `X-Bridge-Auth` header into client HTTP requests.
- `src/test/phase02_bridge_server_auth_and_cors.test.ts` - Comprehensive file-based test for Phase 02.

## Test Criteria
- Exactly one file-based test: `src/test/phase02_bridge_server_auth_and_cors.test.ts`.
- [x] Verifies requests with external browser origins (`https://evil.com`) are rejected with 403 Forbidden.
- [x] Verifies requests with valid `vscode-file://` origin or loopback without origin are accepted.
- [x] Verifies requests to `/autoplan-command` without valid auth token return 401 Unauthorized.
- [x] Verifies requests with valid `X-Bridge-Auth` token succeed and dispatch commands properly.

---
Next Phase: phase-03-elevation-command-safety.md
