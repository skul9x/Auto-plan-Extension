# Phase 02: Keyboard Simulation & Prompt Sender Engine
Status: ✅ Completed
Dependencies: Phase 01

## Objective
Xây dựng module gửi phím tắt `Ctrl + Shift + L` để tạo cuộc trò chuyện mới trong Antigravity IDE, nạp văn bản prompt vào clipboard, chọn tất cả (`Ctrl + A`), paste (`Ctrl + V`) và nhấn `Enter` để gửi tin nhắn.

## Requirements
### Functional
- [x] Kích hoạt tổ hợp phím `Ctrl + Shift + L` để mở Conversation mới.
- [x] Chờ khung chat sẵn sàng nhận input (focus).
- [x] Copy `promptText` vào hệ thống clipboard.
- [x] Gửi tổ hợp phím chọn tất cả (`Ctrl + A`), dán (`Ctrl + V`) và nhấn `Enter` để phát tin nhắn.
- [x] Hỗ trợ fallback và tinh chỉnh timing (delay ms) để hoạt động mượt mà, không bị nuốt phím trên Windows.

## Files to Create/Modify
- `src/keyboardManager.ts` - Bộ điều khiển phím tắt & Clipboard automation

## Test Criteria
- [x] Module có thể kích hoạt tổ hợp phím mở chat, paste chuỗi và submit thành công trên Antigravity IDE.
