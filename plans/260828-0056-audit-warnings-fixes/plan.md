# Plan: Audit Warnings & Code Smells Remediation
Created: 2026-08-28 00:56
Status: 🟡 In Progress

## Overview
Remediate all latent warnings and code smells identified during the Performance & Stability Audit:
1. Multi-byte UTF-8 character splitting safety across 64KB stream chunks via `StringDecoder`.
2. Unbounded memory growth protection with a 10MB safety cap on `lineBuffer`.
3. In-memory conversation directory cache pruning (cap at top 100 recent conversations).
4. Legacy test harness modernization to achieve 100% test pass rate across all 14 test suites.
5. Packaging and regression verification.

## Tech Stack
- Runtime: Node.js (v20+), TypeScript (v5.3.3)
- Host Environment: VS Code Extension API (^1.80.0) / Antigravity IDE
- Core Modules: `string_decoder`, `fs.promises`, `events`, `child_process`

## Phases

| Phase | Name | Status | Progress | Test File |
|---|---|---|---|---|
| 01 | Multi-Byte Stream Decoding & Buffer Guard | ⬜ Pending | 0% | `src/test/phase01_stream_decoder_buffer_guard.test.ts` |
| 02 | Legacy Test Modernization & Alignment | ⬜ Pending | 0% | `src/test/phase02_test_suite_modernization.test.ts` |
| 03 | E2E Regression & VSIX Integrity Verification | ⬜ Pending | 0% | `src/test/phase03_audit_warnings_e2e_verification.test.ts` |

## Quick Commands
- Start Phase 1: `/code phase-01`
- Check progress: `/next`
- Audit report: `docs/reports/audit_2026-08-28.md`
