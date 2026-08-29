# Phase 02: Local HTTP/IPC Bridge Server & Dispatch Protocol

Status: ✅ Completed  
Dependencies: Phase 01  

## Objective
Implement a high-performance, fault-tolerant local HTTP/IPC microserver (`src/bridgeServer.ts`) inside the VS Code Extension Host process. The server coordinates real-time communication between the Auto-Plan Orchestrator (Node.js) and the Electron Renderer DOM script (`autoplan-dom-bridge.js`). It manages dynamic port allocation (ports 48860-48900), CORS headers for Electron WebContents, secure handshake authentication via window binding keys, action command dispatching (`sendPrompt`, `openNewConversation`, `clickApproval`), execution state queries, and heartbeat telemetry.

---

## Requirements

### Functional Requirements
1. **Dynamic Local Port Allocation**:
   - Bind exclusively to loopback interface `127.0.0.1` on ports within range `48860` - `48900`.
   - Auto-increment port if occupied by another window or process.
   - Record active port in `ag-autoplan-ports.json` in the workbench directory for instant client discovery.
2. **CORS & WebContents Compatibility**:
   - Send standard CORS headers on all HTTP responses:
     ```http
     Access-Control-Allow-Origin: *
     Access-Control-Allow-Methods: GET, POST, OPTIONS
     Access-Control-Allow-Headers: Content-Type, X-Window-Key
     ```
   - Automatically handle `OPTIONS` preflight requests with `204 No Content` / `200 OK`.
3. **Window Key Binding & Isolation**:
   - Issue and validate unique window binding keys (`windowKey`) so multiple editor windows don't cross-trigger commands.
   - Handle stale client eviction and automatic reconnection.
4. **HTTP REST / JSON Protocol Endpoints**:
   - `GET /autoplan-status`: Client polls configuration, active execution state, and pending commands.
   - `POST /autoplan-ack`: Client confirms command receipt and status (e.g. `promptInjected`, `submitClicked`, `error`).
   - `POST /autoplan-command`: Orchestrator pushes high-priority prompt commands to be executed immediately by the DOM client.
   - `GET /autoplan-heartbeat`: Lightweight health check for DOM client presence and responsiveness.
5. **Command Queue & Promise-Based Dispatch**:
   - Provide an async API: `bridgeServer.dispatchPromptCommand(promptText, options): Promise<CommandAckResult>`.
   - Resolve promise when the DOM client acknowledges prompt injection and submission.
   - Timeout gracefully if the DOM client does not respond within configurable timeout (default 5000ms).

### Non-Functional Requirements
- **Low Overhead**: Zero CPU usage when idle; minimal payload size (<1KB).
- **Security**: Localhost only (`127.0.0.1`), rejects any external IP connections.

---

## Implementation Steps
1. Create `src/bridgeServer.ts`.
2. Define TypeScript interfaces: `BridgeCommand`, `BridgeCommandAck`, `BridgeServerStatus`, `BridgeClientTelemetry`.
3. Implement `BridgeServer` class with lifecycle methods: `start()`, `stop()`, `isListening()`, `getPort()`.
4. Implement CORS and preflight request middleware.
5. Implement routing and HTTP handlers for `/autoplan-status`, `/autoplan-ack`, `/autoplan-command`, and `/autoplan-heartbeat`.
6. Implement `dispatchPromptCommand(text: string, options?: CommandOptions): Promise<CommandAckResult>`.
7. Implement port persistence to `ag-autoplan-ports.json`.
8. Create file-based unit test suite in `src/test/phase02_bridge_server.test.ts`.

---

## Files to Create / Modify
- `src/bridgeServer.ts` - [NEW] Local HTTP bridge server, protocol handlers, and command queue.
- `src/test/phase02_bridge_server.test.ts` - [NEW] File-based verification test suite.

---

## File-Based Test Specification (`src/test/phase02_bridge_server.test.ts`)
The test file must comprehensively verify:
1. **Server Lifecycle**: Verifies starting, listening on an available port in the 48860-48900 range, and stopping cleanly.
2. **CORS & Preflight Handling**: Verifies `OPTIONS` request returns 200/204 with required `Access-Control-Allow-*` headers.
3. **Handshake & Port Registry**: Verifies that active port and window keys are registered and can be discovered by mock clients.
4. **Command Dispatch & ACK**: Simulates a DOM client polling `/autoplan-status`, receiving a `sendPrompt` payload, and submitting a POST ACK; asserts the `dispatchPromptCommand` promise resolves successfully with timing metadata.
5. **Timeout Handling**: Verifies that when no client polls or ACKs within the timeout window, the command rejects with a descriptive timeout error.
6. **Multi-Window Isolation**: Verifies commands destined for Window A are not delivered to Window B.

---
Next Phase: [Phase 03: Electron Renderer DOM Bridge Script & Prompt Automator](file:///home/skul9x/Desktop/Test_code/Auto-plan-Extension-main/plans/260829-0952-focus-free-dom-bridge/phase-03-dom-renderer-bridge.md)
