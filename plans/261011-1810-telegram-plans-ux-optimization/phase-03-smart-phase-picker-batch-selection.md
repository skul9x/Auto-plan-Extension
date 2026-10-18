# Phase 03: Smart Phase Picker with Batch Selection & Compact Grid

Status: ✅ Completed
Dependencies: phase-02-quick-resume-and-folder-picker.md

## Objective
Cải tiến bàn phím chọn phase thủ công (`buildManualPhaseSelectionKeyboard`) thành giao diện lưới 2 cột tối ưu cho màn hình điện thoại di động, cắt ngắn nhãn nút thông minh để triệt tiêu hiện tượng vỡ layout / dấu chấm lửng (`...`) trên Telegram iOS/Android, bổ sung hàng nút chọn nhanh hàng loạt (`[✅ Tất cả]`, `[⚡ Chưa chạy]`, `[⬜ Bỏ chọn]`), và phân tầng phản hồi xúc giác (Silent, Toast, Alert Popup).

## Requirements
### Functional
- [x] **Hàng điều khiển chọn hàng loạt (Batch Selection Row)**:
  - Đặt ở hàng đầu tiên của bàn phím với 3 nút:
    - `[✅ Tất cả]`: Chọn toàn bộ phase trong thư mục kế hoạch.
    - `[⚡ Chưa chạy]`: Chỉ chọn các phase có `isCompleted === false`.
    - `[⬜ Bỏ chọn]`: Bỏ chọn toàn bộ phase trong session.
  - Phản hồi nhanh qua Toast notification (`ctx.answerCallbackQuery({ text: '⚡ Đã chọn X phase' })`).
- [x] **Lưới 2 Cột Compact & Cắt ngắn nhãn nút di động (Mobile Truncation Rule)**:
  - Hiện tượng: Trên màn hình smartphone (320px - 375px), bàn phím 2 cột của Telegram sẽ tự động cắt nhãn bằng `...` nếu text dài hơn 12-14 ký tự.
  - Định dạng nút chuẩn:
    `[${checked ? '✅' : '⬜'} P${padIndex}: ${shortSlug}]`
    (Ví dụ: `[✅ P01: Visual..]` `[⬜ P02: Quick..]`).
  - `padIndex`: Định dạng 2 chữ số (`P01`, `P02`, ...).
  - `shortSlug`: Lấy phần tên rút gọn tối đa 8-10 ký tự.
  - **Giữ chi tiết trong nội dung tin nhắn**: Thân tin nhắn hiển thị đầy đủ tên nguyên bản và trạng thái của từng phase:
    ```text
    📋 CHỌN PHASE THỰC THI (feature-auth)
    1️⃣ Phase 01: Visual Progress Bar Engine [Chưa chạy]
    2️⃣ Phase 02: Quick Resume & Folder Picker [Đã xong]
    
    Chạm vào nút bên dưới để chọn, sau đó nhấn Bắt đầu:
    ```
- [x] **Nút kích hoạt thực thi động & Alert Modal**:
  - Nút thực thi hiển thị trực quan số phase đã chọn: `[▶️ Bắt đầu (3/5 phase)]`.
  - Hàng điều hướng kèm: `[🔙 Quay lại]`.
  - **Zero Selection Guard**: Nếu người dùng bấm Bắt đầu khi chưa chọn phase nào (0 phase), không khởi chạy và hiển thị modal cảnh báo:
    `ctx.answerCallbackQuery({ text: '⚠️ Vui lòng chọn ít nhất 1 phase để thực thi!', show_alert: true })`.
- [x] **Phân tầng phản hồi xúc giác (Feedback Strategy)**:
  - Toggle từng checkbox: Gọi ngay `ctx.answerCallbackQuery()` không truyền text (silent, không rung/chuông) rồi cập nhật markup qua `editMessageReplyMarkup`.
  - Batch select: Hiển thị toast brief thông báo số lượng phase đã chọn.
  - Lỗi / Điều kiện chặn: Hiển thị hộp thoại modal (`show_alert: true`).
- [x] **Routing Callback Compact & Tương thích ngược**:
  - `p:bt:<all|pnd|clr>:<folderId>` (Batch Selection)
  - `p:tog:<folderId>:<index>` (Toggle Phase)
  - `p:run:man:<folderId>` (Start Manual Run)
  - Giữ lại các alias cũ: `tog:<folderId>:<index>`, `start:manual:<folderId>`.

### Non-Functional
- [x] Độ trễ phản hồi: Mỗi thao tác toggle hoặc batch cập nhật markup trong < 30ms.
- [x] Giới hạn Payload: Mọi callback string tạo ra phải <= 64 bytes.

## Implementation Steps
1. Bổ sung các phương thức chọn hàng loạt (`selectAllPhases`, `selectPendingPhasesOnly`, `clearPhaseSelection`) vào `TelegramPlanManager`.
2. Xây dựng hàm định dạng nhãn nút 2 cột ngắn gọn `formatCompactPhaseButtonLabel`.
3. Cập nhật `buildManualPhaseSelectionKeyboard` với hàng batch controls, lưới 2 cột và nút đếm động.
4. Đăng ký các callback handler `p:bt:`, `p:tog:`, `p:run:man:` kèm alias cũ.
5. Triển khai phân tầng phản hồi callback query (Silent vs Toast vs Alert).
6. Tạo và chạy bộ kiểm thử độc lập: `src/test/phase03_smart_phase_picker_batch_selection.test.ts`.

## Files to Create/Modify
- `src/telegramPlanManager.ts` - Batch selection methods, compact 2-column grid formatter, dynamic counter button, callback handlers.
- `src/test/phase03_smart_phase_picker_batch_selection.test.ts` - File kiểm thử độc lập Phase 03.

## Test Criteria
- File kiểm thử: `src/test/phase03_smart_phase_picker_batch_selection.test.ts`.
- [x] Kiểm thử nút `[✅ Tất cả]` chọn đúng toàn bộ index các phase.
- [x] Kiểm thử nút `[⚡ Chưa chạy]` chỉ lọc và chọn các phase có `isCompleted === false`.
- [x] Kiểm thử nút `[⬜ Bỏ chọn]` xóa sạch danh sách index đã chọn.
- [x] Kiểm thử toggle độc lập từng phase đảo trạng thái chính xác.
- [x] Kiểm thử nhãn nút hiển thị đúng định dạng `[✅ P01: slug]` không vượt quá giới hạn chiều rộng di động.
- [x] Kiểm thử Zero Selection Guard hiển thị alert modal khi chọn 0 phase.
- [x] Kiểm thử 100% callback data <= 64 bytes.

---
Next Phase: phase-04-live-control-dashboard-execution.md
