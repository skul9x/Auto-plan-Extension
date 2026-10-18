# Phase 04: Interactive Live Control Dashboard during Execution

Status: ✅ Completed
Dependencies: phase-03-smart-phase-picker-batch-selection.md

## Objective
Chuyển đổi tin nhắn Telegram thành bảng điều khiển tương tác trực tiếp (Live Control Dashboard) ngay khi một kế hoạch bắt đầu chạy. Thay vì thay thế bằng tin nhắn văn bản tĩnh hoặc spam tin nhắn mới vào cuộc trò chuyện, tin nhắn ban đầu được cập nhật tại chỗ (`editMessageText`) kèm thanh tiến độ trực quan, trạng thái phase đang chạy và các nút điều khiển (`[⏭️ Bỏ qua Phase]`, `[🛑 Dừng lại]`, `[📸 Chụp màn hình]`, `[🔄 Cập nhật]`), kết hợp cơ chế Throttling chống rate-limit và xử lý mềm lỗi Telegram "message is not modified".

## Requirements
### Functional
- [x] **Cấu trúc giao diện Live Control Dashboard (`buildExecutionDashboard`)**:
  - **Nội dung tin nhắn mẫu**:
    ```text
    ▶️ ĐANG THỰC THI KẾ HOẠCH
    📁 Kế hoạch: [Tên plan]
    ⏳ Đang chạy: Phase [XX] - [Tên phase]
    📊 Tiến độ: ▰▰▰▰▰▱▱▱ 62% (3/5 phase)
    ```
  - **Bàn phím điều khiển Hàng 1 (Vận hành)**:
    - `[⏭️ Bỏ qua Phase]`: Kích hoạt `autoplan.skipPhase` / `orchestrator.skipCurrentPhase()`.
    - `[🛑 Dừng lại]`: Kích hoạt `autoplan.stop` / `orchestrator.stop()`.
  - **Bàn phím điều khiển Hàng 2 (Tiện ích)**:
    - `[📸 Chụp màn hình]`: Chụp ảnh màn hình desktop và gửi ảnh trực tiếp vào chat, giữ nguyên dashboard.
    - `[🔄 Cập nhật]`: Truy vấn lại trạng thái Orchestrator và render lại dashboard.
  - **Bàn phím điều khiển Hàng 3 (Điều hướng)**:
    - `[📂 Danh sách Plans]`: Trở về màn hình chính `/plans`.
- [x] **Cơ chế chống Rate-Limit Telegram (Dashboard Update Throttler)**:
  - *Rủi ro*: Telegram giới hạn tần suất ~1 edit/giây/chat. Nếu các phase hoàn thành hoặc chuyển tiếp quá nhanh (< 1000ms), việc gọi `editMessageText` liên tục sẽ dẫn đến HTTP 429 (`Too Many Requests`).
  - *Giải pháp*: Triển khai `DashboardThrottler` với khoảng cách tối thiểu giữa các lần gọi Telegram API là **1200ms**.
  - Các cập nhật trạng thái trung gian được gộp và lên lịch chạy sau khoảng trễ (trailing execution).
  - Các trạng thái kết thúc (`allComplete`, `stopped`, `error`) được ưu tiên bypass bộ đệm và flush ngay lập tức.
- [x] **Xử lý mềm lỗi Telegram "message is not modified"**:
  - *Rủi ro*: Khi người dùng bấm `[🔄 Cập nhật]` mà trạng thái chưa thay đổi, Telegram API ném lỗi `400 Bad Request: message is not modified`.
  - *Giải pháp*:
    - Bắt lỗi này nhẹ nhàng (swallow soft error), tuyệt đối không để crash luồng bot.
    - Luôn gọi `ctx.answerCallbackQuery({ text: '⚡ Trạng thái đã là mới nhất' })` để tắt ngay vòng quay loading trên nút và tạo cảm giác phản hồi tức thì cho người dùng.
- [x] **Tích hợp vòng đời Orchestrator (Event-Driven Integration)**:
  - Lắng nghe các sự kiện EventEmitter từ Orchestrator:
    - `phaseStart`: Cập nhật tên và chỉ số phase đang chạy.
    - `phaseComplete` / `skipped`: Tăng biến đếm hoàn thành, tính toán lại thanh tiến độ.
    - `allComplete`: Chuyển dashboard sang trạng thái hoàn thành:
      `🎉 KẾ HOẠCH ĐÃ HOÀN THÀNH 100%! (5/5 phase)`
      (Gỡ nút Bỏ qua/Dừng lại, hiển thị `[🚀 Chạy lại]` và `[📂 Danh sách Plans]`).
    - `stopped`: Chuyển dashboard sang trạng thái:
      `🛑 KẾ HOẠCH ĐÃ ĐƯỢC DỪNG LẠI`
      (Hiển thị `[⚡ Tiếp tục]` và `[📂 Danh sách Plans]`).
  - Hủy đăng ký listener khi dashboard đóng hoặc kết thúc để tránh rò rỉ bộ nhớ.
- [x] **Tích hợp Chụp ảnh màn hình Desktop không gián đoạn**:
  - Khi bấm `[📸 Chụp màn hình]`:
    - Phản hồi toast: `ctx.answerCallbackQuery({ text: '📸 Đang chụp màn hình desktop...' })`.
    - Gọi cơ chế chụp ảnh từ `TelegramBridge.screenManager.send(bot, chatId, ...)`.
    - Tin nhắn Live Dashboard không bị ghi đè hay mất bàn phím điều khiển.
- [x] **Khôi phục lỗi hiển thị (Graceful Fallback)**:
  - Nếu `editMessageText` thất bại do tin nhắn cũ bị xóa hoặc hết hạn session, tự động gửi tin nhắn dashboard mới bằng `ctx.reply`.

### Non-Functional
- [x] Tuyệt đối không spam: Giữ đúng 1 tin nhắn dashboard duy nhất trong suốt phiên chạy của kế hoạch.
- [x] Khả năng chịu lỗi: Bắt trọn vẹn lỗi mạng và lỗi Telegram entity formatting.

## Implementation Steps
1. Xây dựng hàm `buildExecutionDashboard` định dạng tin nhắn và bàn phím điều khiển trong `src/telegramPlanManager.ts`.
2. Triển khai lớp `DashboardThrottler` (khoảng cách tối thiểu 1200ms) để điều tiết các cuộc gọi `editMessageText`.
3. Đăng ký các callback handler cho dashboard:
   - `p:db:skip` (Bỏ qua phase)
   - `p:db:stop` (Dừng thực thi)
   - `p:db:scr` (Chụp màn hình)
   - `p:db:ref` (Làm mới trạng thái)
   - `p:db:nav` (Về danh sách)
4. Kết nối các sự kiện của `Orchestrator` (`phaseStart`, `phaseComplete`, `allComplete`, `stopped`) với throttler của dashboard.
5. Xử lý mềm lỗi `message is not modified` và tích hợp gửi ảnh màn hình qua `screenManager`.
6. Tạo và chạy bộ kiểm thử độc lập: `src/test/phase04_live_control_dashboard_execution.test.ts`.

## Files to Create/Modify
- `src/telegramPlanManager.ts` - Triển khai `buildExecutionDashboard`, `DashboardThrottler`, và các dashboard callback handlers.
- `src/telegramBridge.ts` - Kết nối sự kiện orchestrator và quyền gọi screenshot vào `TelegramPlanManager`.
- `src/test/phase04_live_control_dashboard_execution.test.ts` - File kiểm thử độc lập Phase 04.

## Test Criteria
- File kiểm thử: `src/test/phase04_live_control_dashboard_execution.test.ts`.
- [x] Kiểm thử định dạng dashboard hiển thị chuẩn tên kế hoạch, phase hiện tại và thanh tiến độ block.
- [x] Kiểm thử `DashboardThrottler`: các sự kiện phát liên tục trong 1200ms được điều tiết đúng và không gọi API dồn dập.
- [x] Kiểm thử nút `[⏭️ Bỏ qua Phase]` kích hoạt hàm skip của Orchestrator thành công.
- [x] Kiểm thử nút `[🛑 Dừng lại]` kích hoạt hàm stop và chuyển đổi giao diện dashboard sang trạng thái dừng.
- [x] Kiểm thử xử lý lỗi `message is not modified`: bot không văng exception và phản hồi toast `⚡ Trạng thái đã là mới nhất`.
- [x] Kiểm thử nút `[📸 Chụp màn hình]` kích hoạt chụp ảnh màn hình và duy trì dashboard.
- [x] Kiểm thử trạng thái kết thúc `allComplete` hiển thị huy hiệu hoàn thành 100%.

---
Next Phase: phase-05-e2e-integration-and-release.md
