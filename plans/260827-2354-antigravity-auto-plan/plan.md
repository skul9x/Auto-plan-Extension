# Plan: Antigravity Auto-Plan Automation Extension (.vsix)
Created: 2026-08-27T23:54:00+07:00
Status: 🟡 In Progress

## Overview
VS Code Extension cài trực tiếp vào Antigravity IDE:
- Tự động kích hoạt shortcut `Ctrl + Shift + L` để tạo Conversation mới.
- Dán nội dung prompt mẫu và gửi tin nhắn.
- Lắng nghe file transcript log của Antigravity để bắt từ khóa `"Done skul9x."` khi Agent hoàn thành.
- Tự động lặp lại quy trình 5 lần (hoặc theo số lượt cấu hình) kèm Status Bar hiển thị tiến độ và nút Stop khẩn cấp.
- Đóng gói file `.vsix` hoàn chỉnh để cài đặt 1-click vào Antigravity IDE.

## Tech Stack
- Platform: VS Code Extension Host (TypeScript / Node.js)
- Build System: TypeScript (`tsc`), `@vscode/vsce` (VSIX packager)
- Key Simulation: Windows SendKeys & Clipboard Automation via PowerShell/Node subprocess & VS Code Command API
- File Monitoring: Chokidar / Native fs.watch on `~/.gemini/antigravity-ide/brain/*`

## Phases

| Phase | Name | Status | Progress |
|-------|------|--------|----------|
| 01 | Setup Environment & Extension Scaffold | ✅ Completed | 100% |
| 02 | Keyboard Simulation & Prompt Sender Engine | ✅ Completed | 100% |
| 03 | Real-time Transcript Watcher Engine | ✅ Completed | 100% |
| 04 | Loop Orchestrator & Status Bar UI | ⬜ Pending | 0% |
| 05 | Build VSIX & End-to-End Verification | ⬜ Pending | 0% |

## Quick Commands
- Bắt đầu Phase 1: `/code phase-01`
- Thiết kế chi tiết: `/design`
- Kiểm tra tiến độ: `/next`
- Lưu context: `/save-brain`
