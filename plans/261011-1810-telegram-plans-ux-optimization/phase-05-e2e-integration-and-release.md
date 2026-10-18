# Phase 05: E2E Integration, Regression Verification & Release Packaging

Status: ✅ Completed
Dependencies: phase-04-live-control-dashboard-execution.md

## Objective
Kiểm thử toàn diện toàn bộ hành trình trải nghiệm người dùng xuyên suốt cả 4 màn hình tương tác của `/plans` (Main Folder List với Quick Resume -> Mode Selection -> Smart Phase Picker với Batch Selection -> Live Control Dashboard) trong một bộ test tích hợp độc lập. Đảm bảo 100% các bộ test hồi quy (regression) hiện hữu vẫn vượt qua thành công, biên dịch TypeScript không lỗi, đóng gói file cài đặt VSIX và cập nhật tài liệu phát hành v1.6.4.

## Requirements
### Functional
- [x] **Kiểm thử tích hợp End-to-End User Journey (4 Màn hình)**:
  - **Màn hình 1 (Main Screen)**: Gửi lệnh `/plans` khi có kế hoạch đang mở trong Editor hoặc kế hoạch pending gần nhất; xác nhận nút `[⚡ Tiếp tục: <Tên>]` xuất hiện ở vị trí đầu tiên, danh sách folder hiển thị kèm thanh tiến độ trực quan.
  - **Màn hình 2 (Mode Selector)**: Chọn thư mục; xác nhận menu hiển thị thông tin tiến độ tổng thể và 3 chế độ (Chạy pending, Chạy toàn bộ, Tùy chọn thủ công).
  - **Màn hình 3 (Smart Phase Picker)**: Chọn chế độ thủ công; kiểm thử bấm nút batch `[⚡ Chưa chạy]`, toggle một phase riêng lẻ trong lưới 2 cột, kiểm tra nút đếm động `[▶️ Bắt đầu (X/Y phase)]`.
  - **Màn hình 4 (Live Control Dashboard)**: Bấm Bắt đầu; xác nhận tin nhắn chuyển đổi tại chỗ (`editMessageText`) thành Live Dashboard với tiến độ phần trăm và thanh block Unicode `▰▰▰▱▱`.
  - **Tương tác trực tiếp trên Dashboard**: Mô phỏng bấm `[⏭️ Bỏ qua Phase]`, `[🛑 Dừng lại]`, `[📸 Chụp màn hình]` và `[🔄 Cập nhật]`.
- [x] **Xác thực An toàn & Ràng buộc Kỹ thuật (Safety Auditing)**:
  - **Assertion 64-byte**: Duyệt qua 100% tất cả các nút bấm `InlineKeyboard` sinh ra trong mọi trạng thái của bot; khẳng định `Buffer.byteLength(btn.callback_data, 'utf8') <= 64`.
  - **Parse Mode Safety**: Kiểm tra định dạng tin nhắn chứa các tên folder có nhiều dấu gạch dưới (`feature_test_user_flow`) không bao giờ phát sinh lỗi phân tích cú pháp Telegram.
  - **Throttling Verification**: Kiểm tra cơ chế `DashboardThrottler` chặn các đợt phát sự kiện dồn dập trong khoảng 1200ms để chống lỗi 429 Too Many Requests.
  - **Message is not modified Resilience**: Kiểm thử bấm Cập nhật khi không có thay đổi không gây văng exception và trả về toast xác nhận.
- [x] **Xác thực Hồi quy (Regression Verification)**:
  - Chạy và khẳng định các bộ test trước đó vẫn pass 100%:
    - `node out/test/phase02_plan_discovery_selector.test.js`
    - `node out/test/phase05_telegram_integration_e2e.test.js`
- [x] **Phát hành & Đóng gói (Release & Packaging)**:
  - Nâng version trong `package.json` lên `1.6.4`.
  - Cập nhật ghi chú phát hành chi tiết trong `CHANGELOG.md`.
  - Cập nhật hướng dẫn sử dụng Telegram Remote Control trong `README.md`.
  - Biên dịch sạch `npm run compile`.
  - Đóng gói file cài đặt chính thức: `antigravity-auto-plan-1.6.4.vsix`.

## Implementation Steps
1. Xây dựng file test tích hợp toàn diện: `src/test/phase05_plans_ux_optimization_e2e.test.ts`.
2. Chạy test xác thực luồng 4 màn hình, 64-byte limit, throttling và resilience.
3. Chạy các test hồi quy hiện hữu để đảm bảo tính tương thích ngược tuyệt đối.
4. Nâng version `package.json` lên `1.6.4`.
5. Cập nhật `CHANGELOG.md` và `README.md`.
6. Chạy `npm run compile` và `npx vsce package`.

## Files to Create/Modify
- `src/test/phase05_plans_ux_optimization_e2e.test.ts` - File kiểm thử tích hợp độc lập Phase 05.
- `package.json` - Nâng phiên bản lên 1.6.4.
- `CHANGELOG.md` - Ghi chú phát hành phiên bản 1.6.4.
- `README.md` - Cập nhật hướng dẫn Telegram Remote Control UX mới.

## Test Criteria
- File kiểm thử: `src/test/phase05_plans_ux_optimization_e2e.test.ts`.
- [x] Xác nhận luồng tương tác 4 màn hình hoạt động trơn tru không lỗi.
- [x] Xác nhận 100% callback data trên mọi bàn phím Inline Keyboard đều <= 64 bytes.
- [x] Xác nhận `DashboardThrottler` điều tiết các cập nhật tin nhắn đúng tần suất >= 1200ms.
- [x] Xác nhận nút Skip, Stop, Screen Capture và Refresh hoạt động chính xác.
- [x] Xác nhận các bộ test hồi quy `phase02_plan_discovery_selector` và `phase05_telegram_integration_e2e` pass 100%.
- [x] Đóng gói thành công file VSIX production `antigravity-auto-plan-1.6.4.vsix`.

---
Next Phase: None (Plan Complete)
