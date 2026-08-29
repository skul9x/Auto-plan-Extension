# Phase 02: BridgeServer Log Ingestion API & IPC Tracing

Status: ✅ Completed  
Dependencies: Phase 01  
Target Files:
- `src/bridgeServer.ts`
- `src/promptDispatcher.ts`
- `src/test/phase02_bridgeserver_log_tracing.test.ts`

---

## Objective
Extend `BridgeServer` and `PromptDispatcher` to provide a high-throughput HTTP log ingestion endpoint (`POST /autoplan-log`), complete command lifecycle instrumentation, and granular handshake tracing that automatically funnels client/server events into `DebugLogger`.

## Requirements

### Functional Requirements
1. **HTTP Ingestion Endpoint (`POST /autoplan-log`)**:
   - Accept JSON payloads containing single log entries or batch arrays from `DomBridgeClient`:
     ```json
     {
       "windowKey": "win_123",
       "logs": [
         {
           "level": "INFO",
           "component": "CLIENT",
           "message": "Connected to BridgeServer on port 48860",
           "details": { "userAgent": "Electron", "url": "workbench.html" }
         }
       ]
     }
     ```
   - Also accept shorthand single entry payloads: `{ "level": "WARN", "message": "...", "details": { ... } }`.
   - Validate payload structure, apply client tags, and pipe records directly into `DebugLogger`.
   - Return `200 OK` with `{ "success": true, "accepted": count }`.
   - Limit max payload body (1MB) to prevent memory exhaustion attacks.
2. **BridgeServer Lifecycle & Handshake Tracing**:
   - Log server startup, port binding resolution (e.g. `[SERVER] Bound to port 48860 (PID: 12345)`), and port conflict retries.
   - Log client discovery probes (`GET /autoplan-status?probe=1`), heartbeat pings, and active window key changes.
   - Log watchdog eviction events (`[SERVER] Evicted client ${key} after ${staleMs}ms inactivity`).
   - Trace full prompt command lifecycle:
     - Log command queuing: `commandId`, type, character count, target window, timeout.
     - Log client command retrieval upon polling tick.
     - Log ACK processing: status, execution latency in milliseconds, metadata or error message.
     - Log command timeout escalation: state snapshot (whether client ever polled/fetched the command).
3. **PromptDispatcher Pre-flight & Fallback Tracing**:
   - In `PromptDispatcher`, log pre-flight validation decisions (`[DISPATCHER] Readiness check passed: tier=domBridge, connectedClients=1`).
   - Log prompt dispatch execution start with truncated prompt preview (e.g. `[DISPATCHER] Dispatching prompt: "Implement code..." (Total 450 chars)`).
   - Log exact transition causes when falling back between tiers (Tier 1 -> Tier 2 -> Tier 3) with execution duration.
   - Capture failure stack traces and latency numbers into `DebugLogger` for post-mortem diagnostics.

### Non-Functional Requirements
- High-throughput non-blocking request handling without blocking the Node.js event loop.
- Robust exception handling protecting the HTTP server against malformed JSON or corrupted HTTP streams.

## Files to Create / Modify
- `src/bridgeServer.ts` - Add `POST /autoplan-log` handler and instrumentation throughout server and dispatch methods.
- `src/promptDispatcher.ts` - Integrate `DebugLogger` into tier dispatching, fallback routing, and validation.

## Verification Test
- **Single Test**: `src/test/phase02_bridgeserver_log_tracing.test.ts`
- **Validation Scope**:
  - Verify `POST /autoplan-log` endpoint accepts single and batch log records.
  - Verify server startup, client discovery probe, and heartbeat emit structured logs into `DebugLogger`.
  - Verify prompt dispatch lifecycle (queue -> poll -> ack) emits complete traces with execution duration.
  - Verify prompt timeout captures client fetch state and duration.
  - Verify tier fallback events in `PromptDispatcher` generate actionable log traces into `DebugLogger`.
