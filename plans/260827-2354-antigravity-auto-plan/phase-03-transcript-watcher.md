# Phase 03: Real-time Transcript Watcher Engine
Status: ✅ Completed
Dependencies: Phase 01

## Objective
Xây dựng engine theo dõi log transcript thời gian thực của Antigravity (`~/.gemini/antigravity-ide/brain/`), phát hiện conversation mới được tạo và lắng nghe khi nào Agent phản hồi chuỗi từ khóa `"Done skul9x."`.

## Requirements
### Functional
- [x] Tự động định vị thư mục App Data của Antigravity: `C:\Users\<User>\.gemini\antigravity-ide\brain\` hoặc đọc biến môi trường.
- [x] Phát hiện conversation folder mới nhất được khởi tạo sau thời điểm bấm `Ctrl + Shift + L`.
- [x] Lắng nghe (tail stream) file `transcript.jsonl` (hoặc `transcript_full.jsonl`).
- [x] Parse các dòng JSON log, tìm kiếm keyword `Done skul9x.` trong content phản hồi của `MODEL` / `PLANNER_RESPONSE`.
- [x] Bắn callback / Event `onCompletionDetected` ngay khi phát hiện từ khóa.
- [x] Hỗ trợ Timeout an toàn (nếu sau X phút không nhận được phản hồi sẽ thông báo cảnh báo).

## Files to Create/Modify
- `src/transcriptWatcher.ts` - Log transcript monitor & keyword detector

## Test Criteria
- [x] Khi mock append 1 dòng log có chứa `"Done skul9x."` vào file transcript, Watcher kích hoạt callback trong vòng < 200ms.
