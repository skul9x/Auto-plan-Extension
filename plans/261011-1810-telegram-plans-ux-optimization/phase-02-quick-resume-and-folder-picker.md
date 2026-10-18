# Phase 02: One-Click Quick Resume & Enhanced Folder Picker

Status: ✅ Completed
Dependencies: phase-01-visual-progress-and-localization.md

## Objective
Xây dựng nút thao tác nhanh `[⚡ Tiếp tục]` (One-Click Quick Resume) ngay ở đầu màn hình `/plans` cho phép người dùng tiếp tục thực thi các phase còn lại của kế hoạch phù hợp nhất (đang mở trong Editor hoặc có cập nhật mới nhất) mà không phải qua nhiều tầng menu. Nâng cấp bàn phím duyệt thư mục kế hoạch với thanh tiến độ mini, phân trang 5 mục/trang tối ưu cho mobile, và bảo vệ giới hạn payload 64 bytes của Telegram.

## Requirements
### Functional
- [x] **Smart Top Plan Resolution (Xác định kế hoạch ưu tiên)**:
  - **Ưu tiên 1**: File đang mở trong Editor (`vscode.window.activeTextEditor`). Hỗ trợ nhận diện cả `plan.md` hoặc bất kỳ file `phase-*.md` nào nằm trong thư mục plan.
  - **Ưu tiên 2**: Nếu không mở plan trong Editor, duyệt qua các folder có `pendingPhases > 0`, sắp xếp giảm dần theo thời gian sửa đổi gần nhất (`mtimeMs` của `plan.md` hoặc phase markdown mới nhất). Chọn thư mục đầu tiên.
- [x] **Điều kiện hiển thị & Nút One-Click Quick Resume**:
  - **Eligibility Guard**: Chỉ hiển thị nút `[⚡ Tiếp tục: <Tên ngắn>]` khi kế hoạch mục tiêu có `pendingPhases > 0`. Nếu kế hoạch đã hoàn thành 100%, không hiển thị nút Tiếp tục để tránh gây hiểu nhầm (hoặc hiển thị `[🚀 Chạy lại toàn bộ]`).
  - Tên kế hoạch trên nút được rút gọn thông minh (max 18 ký tự) để đảm bảo không bị tràn nút trên mobile.
  - Nhấp vào nút này sẽ kích hoạt trực tiếp các phase chưa hoàn thành (`pendingPhases`) tới `Orchestrator` và chuyển ngay sang Live Dashboard.
- [x] **Concurrency Guard (Chống chạy trùng lặp)**:
  - Trước khi khởi chạy, kiểm tra `orchestrator.isRunning()`.
  - Nếu hệ thống đang trong quá trình thực thi, không tạo tiến trình mới, cảnh báo người dùng qua `ctx.answerCallbackQuery({ text: '⚠️ Đang có kế hoạch khác đang chạy!', show_alert: true })` và hiển thị Live Dashboard của phiên chạy hiện tại.
- [x] **Bàn phím duyệt Folder thông minh & Phân trang Mobile**:
  - Giới hạn phân trang: tối đa **5 thư mục/trang** để bàn phím không chiếm hết chiều cao màn hình smartphone.
  - Mỗi mục thư mục hiển thị kèm tiến độ:
    `1️⃣ 261011-security-fix`
    `▰▰▰▰▱▱▱▱ 50% (2/4 phase)`
  - Hàng điều hướng phân trang: `[◀️ Trước]` `[Trang 1/3]` `[Sau ▶️]`.
  - Nút chuyển chế độ lọc: `[📑 Xem tất cả]` ⮂ `[⚡ Chỉ chưa xong]`.
  - Nút làm mới bộ nhớ đệm: `[🔄 Quét lại]`.
- [x] **Mã hóa Compact `callback_data` & Tương thích ngược**:
  - Toàn bộ `callback_data` mới tuân thủ tiền tố ngắn và độ dài <= 64 bytes:
    - `p:res:<folderId>` (Quick Resume, ~16 bytes)
    - `p:fld:<folderId>` (Chọn folder, ~16 bytes)
    - `p:pg:<page>` (Phân trang, ~9 bytes)
    - `p:flt:<all|pnd>` (Lọc pending/all, ~11 bytes)
    - `p:ref` (Làm mới disk cache, 5 bytes)
  - Giữ lại các router callbacks cũ (`fld:`, `fld_page:`, `act:run:`, `act:browse`) làm alias để duy trì 100% tương thích với các script gọi cũ và regression tests.
- [x] **Session & Cache TTL Pruning (Chống tràn bộ nhớ)**:
  - Tự động dọn dẹp các session và folder cache cũ hơn 2 giờ hoặc khi vượt quá 100 mục lưu trữ trong memory.

### Non-Functional
- [x] Telegram Payload Constraint: Tuyệt đối không sinh bất kỳ `callback_data` nào vượt quá 64 bytes (có assertion kiểm tra tự động trong test).
- [x] Tốc độ phản hồi: Quét và giải quyết Top Plan hoàn tất trong < 15ms.

## Implementation Steps
1. Bổ sung logic so sánh `mtimeMs` trong `discoverPlanFolders` và cơ chế nhận diện Top Plan trong `src/telegramPlanManager.ts`.
2. Thêm kiểm tra `orchestrator.isRunning()` trước khi dispatch thực thi.
3. Cập nhật `buildFolderPickerKeyboard` với thanh tiến độ mini, phân trang 5 mục/trang và nút Quick Resume nổi bật.
4. Đăng ký các callback handler mới (`p:res:`, `p:fld:`, `p:pg:`, `p:flt:`, `p:ref`) đồng thời giữ lại alias cũ.
5. Triển khai hàm dọn dẹp bộ nhớ đệm session (`pruneStaleSessions`).
6. Tạo và chạy bộ kiểm thử độc lập: `src/test/phase02_plans_quick_resume_and_folder_picker.test.ts`.

## Files to Create/Modify
- `src/telegramPlanManager.ts` - Top Plan resolution, Quick Resume button, compact callback routing, pagination, concurrency guard, session cleanup.
- `src/test/phase02_plans_quick_resume_and_folder_picker.test.ts` - File kiểm thử độc lập Phase 02.

## Test Criteria
- File kiểm thử: `src/test/phase02_plans_quick_resume_and_folder_picker.test.ts`.
- [x] Kiểm thử phát hiện đúng file plan trong editor và đặt nút Quick Resume lên vị trí đầu tiên.
- [x] Kiểm thử fallback sang plan pending có thời gian sửa đổi gần nhất khi không có file mở trong editor.
- [x] Kiểm thử Eligibility Guard: không hiển thị nút Quick Resume khi kế hoạch đã 100% hoàn thành.
- [x] Kiểm thử Concurrency Guard: cảnh báo popup và chặn khởi chạy khi orchestrator đang chạy.
- [x] Kiểm thử phân trang 5 thư mục/trang và nút toggle lọc `pendingOnly`.
- [x] Kiểm thử xác nhận 100% `callback_data` sinh ra có độ dài <= 64 bytes.

---
Next Phase: phase-03-smart-phase-picker-batch-selection.md
