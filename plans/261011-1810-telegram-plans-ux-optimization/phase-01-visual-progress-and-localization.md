# Phase 01: Visual Progress Bar Engine & Safe Vietnamese Localization

Status: ✅ Completed
Dependencies: None

## Objective
Xây dựng tiện ích render thanh tiến độ trực quan (`renderTextProgressBar`), cơ chế format văn bản an toàn tuyệt đối tránh lỗi phân tích cú pháp Telegram `400 Bad Request: can't parse entities` do dấu gạch dưới (`_`) trong đường dẫn plan, và bản địa hóa toàn bộ giao diện điều khiển `/plans` sang tiếng Việt hiện đại, giữ lại các token song ngữ để đảm bảo tương thích ngược 100% với các bộ kiểm thử hiện hữu.

## Requirements
### Functional
- [x] **Tiện ích render thanh tiến độ trực quan `renderTextProgressBar`**:
  - Signature: `renderTextProgressBar(completed: number, total: number, options?: { length?: number; style?: 'block' | 'ascii'; showPercent?: boolean }): string`.
  - Ký tự chuẩn: Filled `▰` (U+25B0) và Empty `▱` (U+25B1) - hai ký tự có độ rộng hiển thị đồng đều nhất trên font hệ thống của iOS, Android và Telegram Desktop.
  - Chiều dài mặc định: `8` ký tự (tối ưu hiển thị ngang trên màn hình điện thoại 320px - 375px mà không bị ngắt dòng).
  - Tính toán phần trăm chính xác: `total <= 0 ? 0 : Math.min(100, Math.max(0, Math.round((completed / total) * 100)))`.
  - Xử lý biên triệt để:
    - `total = 0`: Trả về `▱▱▱▱▱▱▱▱ 0%` (không bao giờ sinh `NaN%`).
    - `completed > total`: Clamp ở mức `100%` (`▰▰▰▰▰▰▰▰ 100%`).
    - `completed < 0`: Clamp ở mức `0%`.
- [x] **Tiện ích an toàn chuỗi Telegram (`escapeTelegramMarkdown` / `formatSafePlanText`)**:
  - Nguyên nhân gốc rễ lỗi `400 Bad Request`: Telegram legacy Markdown (V1) coi dấu gạch dưới `_` là ký tự mở/đóng in nghiêng (*italics*). Khi đường dẫn folder hoặc phase chứa `_` (như `261011_telegram_ux`), nếu không escape hoặc không đóng trong code span, Telegram API lập tức từ chối tin nhắn.
  - Hàm tiện ích tự động escape các ký tự đặc biệt (`_`, `*`, `[`, `` ` ``) ngoài khối code span, hoặc định dạng sang plain text sạch / safe Markdown.
- [x] **Bản địa hóa tiếng Việt & Tương thích ngược Bilingual Tokens**:
  - Tiêu đề danh sách: `📂 QUẢN LÝ KẾ HOẠCH (Plan Folders)` (chứa token `Plan Folders` tương thích test).
  - Kế hoạch đang mở: `📄 KẾ HOẠCH ĐANG MỞ (Active Plan Detected)`.
  - Trạng thái trống: `ℹ️ Không tìm thấy thư mục kế hoạch nào trong workspace. (No plan folders found)`.
  - Hoàn thành tất cả: `🎉 Tất cả kế hoạch trong workspace đã hoàn thành 100%! (0 pending phases)`.
  - Chọn chế độ thực thi:
    - Nội dung: `📁 Kế hoạch: [Tên plan]\nTiến độ: ▰▰▰▰▱▱▱▱ 50% (2/4 phase)\n\nChọn chế độ thực thi (Choose execution mode):`
    - Nút 1: `[⚡ Chạy các Phase còn lại]`
    - Nút 2: `[🚀 Chạy lại toàn bộ từ đầu]`
    - Nút 3: `[📋 Tùy chọn từng Phase thủ công]`
    - Nút 4: `[🔙 Quay lại danh sách]`

### Non-Functional
- [x] Tốc độ thực thi: `renderTextProgressBar` chạy trong < 0.05ms, zero external dependencies.
- [x] An toàn bộ nhớ: Không tạo RegExp phức tạp gây ReDoS trên đường dẫn file dài.
- [x] Type Safety: Xuất đầy đủ TypeScript types và interfaces trong `src/telegramUtils.ts`.

## Implementation Steps
1. Bổ sung `renderTextProgressBar` và `escapeTelegramMarkdown` / `formatSafePlanText` vào `src/telegramUtils.ts`.
2. Cập nhật các template tin nhắn và nhãn nút trong `src/telegramPlanManager.ts` sang tiếng Việt kết hợp bilingual tokens.
3. Tích hợp thanh tiến độ `renderTextProgressBar` vào phần tóm tắt kế hoạch của `/plans` và menu chọn chế độ thực thi.
4. Export các hàm tiện ích mới và kiểm tra TypeScript compilation (`npm run compile`).
5. Tạo và chạy bộ kiểm thử độc lập: `src/test/phase01_plans_visual_progress_and_localization.test.ts`.

## Files to Create/Modify
- `src/telegramUtils.ts` - Thêm `renderTextProgressBar` và hàm escape an toàn.
- `src/telegramPlanManager.ts` - Tích hợp thanh tiến độ trực quan và bản địa hóa template.
- `src/test/phase01_plans_visual_progress_and_localization.test.ts` - File kiểm thử độc lập Phase 01.

## Test Criteria
- File kiểm thử: `src/test/phase01_plans_visual_progress_and_localization.test.ts`.
- [x] Kiểm thử `renderTextProgressBar` với các mốc: 0%, 25%, 50%, 75%, 100%.
- [x] Kiểm thử các trường hợp biên: `total = 0`, `completed > total`, `completed < 0`, độ dài tùy biến (8 ký tự, 10 ký tự).
- [x] Kiểm thử escape ký tự `_` trong chuỗi tên folder (`feature_auth_2026`) đảm bảo không gây lỗi phân tích cú pháp.
- [x] Kiểm thử `TelegramPlanManager` render đầy đủ tiêu đề song ngữ thân thiện tiếng Việt và thỏa mãn assertion của test hiện hữu (`Plan Folders`, `Active Plan Detected`).

---
Next Phase: phase-02-quick-resume-and-folder-picker.md
