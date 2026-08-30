# Phase 01: WHATWG URL Migration & Node.js [DEP0169] Deprecation Remediation

Status: ✅ Completed  
Dependencies: None  
Target Files:
- `src/bridgeServer.ts`
- `src/test/phase01_whatwg_url_bridge_server.test.ts`

---

## 1. Objective

Completely eliminate the Node.js `[DEP0169]` deprecation warning by replacing legacy `url.parse()` with the modern WHATWG `new URL()` API in `BridgeServer.handleRequest()`. Ensure all route pathnames, query parameters (e.g. `windowKey`, `probe`), and headers are parsed accurately and securely with zero deprecation warnings emitted on Node.js 20+.

---

## 2. Technical Requirements

1. **Remove Legacy `url` Module Usage (`src/bridgeServer.ts`):**
   - Remove `import * as url from 'url';` if no longer required.
   - In `handleRequest(req: http.IncomingMessage, res: http.ServerResponse)`:
     ```typescript
     const parsedUrl = new URL(req.url || '', 'http://127.0.0.1');
     const pathname = parsedUrl.pathname || '';
     const headerKey = req.headers['x-window-key'];
     const queryKey = parsedUrl.searchParams.get('windowKey');
     const reqWindowKey = (typeof queryKey === 'string' ? queryKey : (typeof headerKey === 'string' ? headerKey : '')).trim();
     ```
2. **Standardize Query Parameter Extraction:**
   - In route `/autoplan-status`:
     ```typescript
     const queryParams: Record<string, string> = Object.fromEntries(parsedUrl.searchParams.entries());
     this.handleGetStatus(reqWindowKey, queryParams, res);
     ```
   - Ensure `isProbe` detection in `handleGetStatus` (`query.probe === '1' || query.probe === 'true'`) works seamlessly with WHATWG `searchParams`.
3. **Preserve Exact Existing Routing & Response Logic:**
   - Routes `/autoplan-status`, `/autoplan-log`, `/autoplan-ack`, `/autoplan-command`, and `/autoplan-heartbeat` continue functioning identically.
   - Invalid routes continue returning 404 with `{ error: 'Not found', pathname }`.

---

## 3. Automated File-Based Test (`src/test/phase01_whatwg_url_bridge_server.test.ts`)

Create a comprehensive standalone test that:
1. Installs a warning listener (`process.on('warning', ...)`) to track any emitted `DeprecationWarning` or `DEP0169`.
2. Starts a `BridgeServer` instance on an ephemeral loopback port.
3. Sends HTTP requests for:
   - `GET /autoplan-status?windowKey=test-win-1&probe=1`
   - `GET /autoplan-status?windowKey=test-win-2`
   - `GET /autoplan-heartbeat` with `x-window-key` header
   - `POST /autoplan-ack` with payload
   - `POST /autoplan-log` with logs
   - `GET /unknown-path` (verifying 404 response structure)
4. Asserts that all HTTP responses return expected status codes and payloads.
5. Asserts that **zero** `DEP0169` deprecation warnings were emitted during the entire test run.
6. Stops the server cleanly.

---

## 4. Verification Plan

```bash
npx tsc && node out/test/phase01_whatwg_url_bridge_server.test.js
```

---
Next Phase: [phase-02-async-plan-scanning-orchestrator.md](./phase-02-async-plan-scanning-orchestrator.md)
