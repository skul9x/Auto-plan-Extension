# Phase 04: Loop Orchestrator & Status Bar UI
Status: 🟢 Completed
Dependencies: Phase 02, Phase 03

## Objective
Kết nối `keyboardManager` và `transcriptWatcher` vào vòng lặp điều phối (Loop Orchestrator), tạo giao diện Status Bar trên thanh dưới của IDE, hiển thị trạng thái `(1/5)...(5/5)` và cơ chế dừng/tiếp tục.

## Requirements
### Functional
- [x] Status Bar Item:
  - Khi idle: `$(play) Auto-Plan (5x)`
  - Khi đang chạy: `$(sync~spin) Auto-Plan: 2/5 (Waiting for Agent...)`
  - Khi dừng: Nút `$(stop) Stop Auto-Plan`
- [x] Vòng lặp điều phối:
  - Bước 1: Gửi tin nhắn lượt `i`.
  - Bước 2: Bắt đầu lắng nghe `Done skul9x.`.
  - Bước 3: Nhận tín hiệu thành công -> Chờ `delayBetweenLoopsMs` -> Tăng `i`.
  - Bước 4: Lặp lại cho đến khi `i === repeatCount`.
- [x] Lệnh nhanh:
  - `autoplan.start`: Bắt đầu chạy vòng lặp.
  - `autoplan.stop`: Dừng ngay lập tức.
  - `autoplan.setPrompt`: Hiển thị InputBox để đổi prompt trực tiếp mà không cần mở Settings.
- [x] Hiển thị thông báo `vscode.window.showInformationMessage` khi hoàn tất toàn bộ chu trình 5 lần.

## Files to Create/Modify
- `src/extension.ts` - Entry point & UI controller
- `src/orchestrator.ts` - State machine & batch loop controller

## Test Criteria
- [x] Bấm Start -> Chạy theo đúng số lượt -> Nút Stop hoạt động ngắt tức thì bất cứ lúc nào.

