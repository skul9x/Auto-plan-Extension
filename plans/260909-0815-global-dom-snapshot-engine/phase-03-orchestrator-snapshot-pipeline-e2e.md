# Phase 03: Orchestrator Pipeline Integration & Multi-Window E2E Verification

Status: ✅ Complete  
Primary Test File: `src/test/phase03_orchestrator_snapshot_pipeline_e2e.test.ts`

---

## 1. Objective

Integrate the `saveWorkbenchSnapshot()` engine directly into the `Orchestrator` execution loop for both initial conversation triggers and subsequent retry attempts, ensuring robust multi-window isolation and regression-free automation.

---

## 2. Technical Scope & Requirements

### 2.1. Initial Conversation Trigger Integration
1. In `src/orchestrator.ts` within the main phase loop, immediately before prompt dispatch (when `phaseRetryCount === 0`):
   ```typescript
   if (phaseRetryCount === 0) {
     await this.saveWorkbenchSnapshot({
       phaseIndex: i,
       phaseName: phase.fileName,
       attempt: 1,
       triggerType: 'initial'
     });
   }
   ```
2. Ensure snapshot capture executes before the prompt is typed or submitted, capturing the pristine state prior to conversation creation.

### 2.2. Retry Conversation Trigger Integration
1. In `src/orchestrator.ts` inside the `catch (err: any)` block for `NewConversationTimeoutError`:
   ```typescript
   if (err instanceof NewConversationTimeoutError) {
     if (phaseRetryCount < maxRetries) {
       phaseRetryCount++;
       this.stopStallWatchdog();

       await this.saveWorkbenchSnapshot({
         phaseIndex: i,
         phaseName: phase.fileName,
         attempt: phaseRetryCount,
         triggerType: 'retry'
       });

       const retryStatusMessage = `Auto-Plan: Retrying Phase ...`;
       // continue countdown delay and retry loop
     }
   }
   ```
2. Snapshot is written before the user notification is displayed and before the countdown delay begins, preserving the exact state of the UI at timeout time.

### 2.3. Multi-Window & Edge Cases Isolation
1. Confirm that snapshots generated when running on Project A go into `~/.autoplan/snapshots/Project_A/`.
2. Confirm that snapshots generated when running on Project B go into `~/.autoplan/snapshots/Project_B/`.
3. Confirm that disabling `autoplan.enableDomSnapshots` in configuration prevents file generation.
4. Ensure abort / stop controls (`this.isAborted`) remain responsive during snapshot operations.

---

## 3. Implementation Steps

1. Wire `saveWorkbenchSnapshot` calls into `executePhases()` loop in `src/orchestrator.ts`.
2. Implement comprehensive integration test in `src/test/phase03_orchestrator_snapshot_pipeline_e2e.test.ts`:
   - Scenario A (Normal run): Dispatches phase, verifies `initial_attempt_1` snapshot generated in project global folder.
   - Scenario B (Retry on timeout): Triggers timeout, verifies `retry_attempt_1` snapshot generated before countdown and retry dispatch succeeds.
   - Scenario C (Multi-window): Switches workspace name context and verifies distinct directory segregation.
   - Scenario D (Disable flag): Disables config and verifies zero snapshots created.
3. Verify test runs cleanly and exits properly.

---

## 4. Verification Test Criteria

- [x] Initial phase execution automatically generates `snapshot_phase_XX_initial_attempt_1_<timestamp>.html`.
- [x] Timeout retry automatically generates `snapshot_phase_XX_retry_attempt_1_<timestamp>.html`.
- [x] Multi-window simulation produces distinct isolated folders under `~/.autoplan/snapshots/`.
- [x] Setting `enableDomSnapshots: false` successfully disables snapshot creation.
- [x] Single test executes and passes all scenarios cleanly.

Verification Command:
```bash
npm run compile && node out/test/phase03_orchestrator_snapshot_pipeline_e2e.test.js
```

---
All Phases Complete
