# Plan: Telegram Plans UX Optimization (Visual Progress, Quick Action, Smart Picker & Live Dashboard)

Created: 2026-10-11 18:10
Status: 🟡 In Progress
Target Version: v1.6.4

## Overview
Toàn diện tối ưu hóa trải nghiệm người dùng (UX) cho lệnh `/plans` trên Telegram Remote Control của Antigravity Auto-Plan Extension. Thay thế giao diện nhiều bước phân mảnh hiện tại bằng luồng tương tác 4 giai đoạn hiện đại, tốc độ cao, thân thiện tuyệt đối trên thiết bị di động:

```mermaid
flowchart TD
    Start["User gửi /plans hoặc /plan_start"] --> Detect{"Kiểm tra Editor & Kế hoạch gần nhất"}
    Detect -->|Có plan pending| ShowMain["Màn hình chính:<br/>[⚡ Tiếp tục: &lt;Tên Plan&gt;]<br/>Danh sách Folders + Thanh tiến độ ▰▰▰▱▱"]
    Detect -->|Không có pending| ShowFinished["Thông báo hoàn thành 100%<br/>[📑 Xem tất cả] [🔄 Quét lại]"]
    
    ShowMain -->|Bấm ⚡ Tiếp tục| ConcurrencyCheck{"Đang chạy plan khác?"}
    ShowMain -->|Chọn Folder| ModeSelector["Chọn chế độ:<br/>[⚡ Chạy các Phase còn lại]<br/>[🚀 Chạy lại toàn bộ]<br/>[📋 Tùy chọn từng Phase thủ công]"]
    
    ModeSelector -->|Tùy chọn thủ công| SmartPicker["Smart Phase Picker (2 Cột)<br/>[✅ Tất cả] [⚡ Chưa chạy] [⬜ Bỏ chọn]<br/>[✅ P01: slug] [⬜ P02: slug]<br/>[▶️ Bắt đầu (X/Y phase)]"]
    
    ConcurrencyCheck -->|Đang chạy| AlertRunning["Popup: ⚠️ Đang có plan khác chạy!<br/>Chuyển sang Live Dashboard"]
    ConcurrencyCheck -->|Sẵn sàng| LiveDashboard
    ModeSelector -->|Bắt đầu| LiveDashboard
    SmartPicker -->|Bắt đầu (>=1 phase)| LiveDashboard
    SmartPicker -->|Bắt đầu (0 phase)| AlertZero["Alert Modal: ⚠️ Vui lòng chọn ít nhất 1 phase!"]
    
    subgraph LiveDashboard ["Interactive Live Control Dashboard (In-Place Edit)"]
        DashContent["▶️ ĐANG THỰC THI KẾ HOẠCH<br/>📁 Kế hoạch: [Tên]<br/>⏳ Phase [XX]: [Tên Phase]<br/>📊 Tiến độ: ▰▰▰▰▰▱▱▱ 62%"]
        DashButtons["[⏭️ Bỏ qua Phase] [🛑 Dừng lại]<br/>[📸 Chụp màn hình] [🔄 Cập nhật]<br/>[📂 Danh sách Plans]"]
    end
```

## Key Architectural Principles & Best Practices
1. **Visual Progress Bar & Font Alignment**:
   - Sử dụng các ký tự khối đồng nhất `▰` (U+25B0, filled) và `▱` (U+25B1, empty) với độ dài chuẩn 8 ký tự (hoặc 10 ký tự). Các ký tự này có cùng chiều rộng hiển thị trên font hệ thống của iOS, Android và Desktop Telegram client.
   - Xử lý biên triệt để: `completed > total` clamp về 100%, `total <= 0` hiển thị `▱▱▱▱▱▱▱▱ 0%`, không bao giờ sinh lỗi `NaN%`.
2. **Safe Text Rendering & Khắc phục lỗi Telegram 400 Bad Request**:
   - Telegram legacy Markdown (`parse_mode: 'Markdown'`) sẽ ném lỗi `400 Bad Request: can't parse entities` khi tên folder hoặc file chứa dấu gạch dưới `_` không đóng cặp (ví dụ `261011_telegram_plans`).
   - Cung cấp tiện ích `formatSafePlanText` / `escapeTelegramMarkdown` hoặc sử dụng plain text sạch với Emoji & Unicode bullet points, đảm bảo 100% không bao giờ crash parser.
   - Giữ bilingual tokens trong tiêu đề (ví dụ `📂 QUẢN LÝ KẾ HOẠCH (Plan Folders)`) để đảm bảo tính tương thích ngược tuyệt đối với các test suite hiện hữu.
3. **One-Click Quick Resume & Concurrency Guard**:
   - Phát hiện file plan đang mở trong VS Code Editor hoặc tự động lấy plan pending có timestamp cập nhật gần nhất.
   - Nút `[⚡ Tiếp tục: <Tên>]` xuất hiện ngay vị trí đầu tiên để chạy ngay các phase chưa hoàn thành. Chỉ hiển thị nút này khi `pendingPhases > 0`.
   - Kiểm tra `orchestrator.isRunning()`: nếu đang có tác vụ chạy, cảnh báo người dùng qua popup `show_alert: true` và mở Live Dashboard thay vì khởi chạy đè.
4. **Smart Phase Picker tối ưu Mobile Screen**:
   - Thiết kế lưới 2 cột gọn gàng, tiền tố chỉ số `P01`, `P02` và cắt ngắn slug tên phase còn tối đa 10-12 ký tự để tránh Telegram tự động cắt ngang bằng `...` trên màn hình điện thoại nhỏ.
   - Toàn bộ danh sách tên phase đầy đủ và trạng thái vẫn được hiển thị rõ ràng trong phần nội dung tin nhắn.
   - 3 nút batch siêu nhanh: `[✅ Tất cả]`, `[⚡ Chưa chạy]`, `[⬜ Bỏ chọn]`.
5. **Interactive Live Control Dashboard & Throttling Engine**:
   - Không spam tin nhắn mới; toàn bộ tiến trình chuyển đổi tin nhắn hiện tại thành Live Dashboard thời gian thực thông qua `editMessageText`.
   - **Throttling (Chống rate-limit Telegram)**: Telegram giới hạn ~1 edit/giây/chat. Tích hợp `DashboardThrottler` với khoảng cách tối thiểu 1200ms giữa các lần gọi Telegram API. Các sự kiện kết thúc (`allComplete`, `stopped`, `error`) được flush ngay lập tức.
   - **Xử lý mềm lỗi "message is not modified"**: Khi người dùng bấm `[🔄 Cập nhật]` mà nội dung chưa đổi, Telegram ném lỗi `400 Bad Request: message is not modified`. Bắt lỗi này nhẹ nhàng và phản hồi toast `⚡ Trạng thái đã là mới nhất` để triệt tiêu spinner tải nút.
   - Nút `[📸 Chụp màn hình]` tích hợp chụp ảnh màn hình desktop và gửi ảnh mà vẫn duy trì tin nhắn dashboard điều khiển.
6. **Tuân thủ nghiêm ngặt 64-byte Callback Data**:
   - Mọi `callback_data` của Inline Keyboard bắt buộc <= 64 bytes.
   - Định dạng bảng mã hóa compact:
     | Action | Pattern | Max Bytes | Ví dụ |
     |---|---|---|---|
     | Quick Resume | `p:res:<folderId>` | 16 bytes | `p:res:f_1a2b3c4d` |
     | Chọn Folder | `p:fld:<folderId>` | 16 bytes | `p:fld:f_1a2b3c4d` |
     | Phân trang Folder | `p:pg:<page>` | 9 bytes | `p:pg:1` |
     | Lọc Pending/All | `p:flt:<flt>` | 11 bytes | `p:flt:all` |
     | Làm mới Folder | `p:ref` | 5 bytes | `p:ref` |
     | Chọn Batch | `p:bt:<all\|pnd\|clr>:<folderId>` | 21 bytes | `p:bt:pnd:f_1a2b3c4d` |
     | Toggle Phase | `p:tog:<folderId>:<index>` | 20 bytes | `p:tog:f_1a2b3c4d:2` |
     | Chạy Manual | `p:run:man:<folderId>` | 20 bytes | `p:run:man:f_1a2b3c4d` |
     | Dashboard Controls | `p:db:<skip\|stop\|scr\|ref>` | 9 bytes | `p:db:skip` |
   - Giữ lại các alias cũ (`fld:`, `mode:`, `tog:`, `start:manual:`) để đảm bảo tương thích ngược 100%.

## Tech Stack
- Runtime: Node.js 20+ / VS Code Extension Host (TypeScript 5.3)
- Bot Framework: `grammY` (v1.21.0+) với `InlineKeyboard`
- UI / Rendering: Telegram Inline Keyboards, In-Place Message Editing (`editMessageText`), Unicode Block Progress Bars (`▰`/`▱`)
- Automation Engine: `TelegramPlanManager`, `Orchestrator` (EventEmitter), `TelegramBridge`
- State Management: In-Memory Short Hash Plan Cache, In-Memory User Selection Sessions có TTL Pruning, Dashboard Update Throttler

## Phases

| Phase | Name | Status | Test |
|-------|------|--------|------|
| 01 | Visual Progress Bar Engine & Safe Vietnamese Localization | ⬜ Pending | `src/test/phase01_plans_visual_progress_and_localization.test.ts` |
| 02 | One-Click Quick Resume & Enhanced Folder Picker | ⬜ Pending | `src/test/phase02_plans_quick_resume_and_folder_picker.test.ts` |
| 03 | Smart Phase Picker with Batch Selection & Compact Grid | ⬜ Pending | `src/test/phase03_smart_phase_picker_batch_selection.test.ts` |
| 04 | Interactive Live Control Dashboard during Execution | ⬜ Pending | `src/test/phase04_live_control_dashboard_execution.test.ts` |
| 05 | E2E Integration, Regression Verification & Release Packaging | ⬜ Pending | `src/test/phase05_plans_ux_optimization_e2e.test.ts` |

## Quick Commands
- Start Phase 1: Implement `phase-01-visual-progress-and-localization.md`
- Run Phase 1 Test: `node out/test/phase01_plans_visual_progress_and_localization.test.js`
- Compile: `npm run compile`
- Packaging: `npm run compile && vsce package`
