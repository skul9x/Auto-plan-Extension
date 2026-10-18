# 💡 BRIEF: Telegram Bot Remote Control & Workflow Bridge for Antigravity Auto-Plan

**Ngày tạo:** 2026-10-11  
**Tác giả & Brainstorm cùng:** skul9x & Antigravity  
**Vị trí triển khai:** Tích hợp trực tiếp module Telegram Bridge vào Extension `Auto-plan-Extension-main` (TypeScript).

---

## 🤖 THÔNG TIN TELEGRAM BOT
- **Bot Username:** [@Antigravity_skul9x_bot](https://t.me/Antigravity_skul9x_bot)
- **Bot Name:** Anti-chat
- **HTTP API Token:** `<YOUR_TELEGRAM_BOT_TOKEN>` (Store securely via `Auto-Plan: Set Telegram Bot Token`)
- **Trạng thái:** ✅ Đã xác thực thành công qua Telegram Bot API.

---

## 1. VẤN ĐỀ CẦN GIẢI QUYẾT
- Lập trình viên khi ra ngoài (đi cafe, di chuyển) muốn điều khiển Antigravity IDE dev code trên PC từ xa mà không cần remote desktop (UltraViewer/AnyDesk) vì remote trên điện thoại rất lag, ngốn pin và khó gõ phím.
- Muốn quản lý quy trình chạy tự động của Auto-Plan, chọn thư mục plan, chọn chế độ chạy (tất cả / chưa done / thủ công), theo dõi tiến độ và tương tác chat trực tiếp với IDE qua điện thoại.

---

## 2. GIẢI PHÁP ĐỀ XUẤT
Tích hợp module **Telegram Remote Bridge** (`src/telegramBridge.ts`) trực tiếp vào **Antigravity Auto-Plan Extension** (TypeScript):
1. **Long Polling Connection:** Sử dụng thư viện `grammY` chạy ngay trong Extension Host. Không cần mở port, NAT-friendly.
2. **Leader Election (Single Bot Instance Guard):** Dựa vào `ag-autoplan-ports.json`, chỉ 1 cửa sổ IDE duy nhất (cửa sổ đầu tiên / active) kích hoạt bot polling để tránh lỗi `409 Conflict` của Telegram khi mở nhiều cửa sổ.
3. **Bảo mật Whitelist:** Chỉ cho phép Telegram User ID được cấu hình trước trong `settings.json` (`autoplan.telegramAllowedUsers`) gửi lệnh. Từ chối 100% người lạ.
4. **Quy trình Quản lý Plan thông minh qua Nút bấm Inline (Interactive UI):**
   - Khi gõ `/plan_start` hoặc `/plans`:
     - Quét các thư mục chứa plan trong workspace.
     - Hiển thị danh sách thư mục bằng nút bấm Telegram: `[📁 plans/auth]` `[📁 plans/payment]`.
     - Sau khi chọn thư mục, hiển thị 3 tùy chọn:
       1. `[🚀 Chạy tất cả các phases]`
       2. `[⚡ Chỉ chạy các phases chưa Done]`
       3. `[📋 Chọn phases thủ công]` ➔ Hiển thị danh sách các file `phase-*.md` để user bấm chọn.
5. **Chat tự do (Free Chat) & Hội thoại:**
   - Mặc định tiếp tục cuộc trò chuyện hiện tại trong IDE để giữ nguyên context của task.
   - Hỗ trợ lệnh `/new_chat` để mở cuộc trò chuyện mới khi cần (`Ctrl + Shift + L`).
6. **Throttle & Rate Limit Guard:**
   - Cập nhật tiến độ mỗi 2-3 giây (edit message), tránh bị Telegram phạt spam `429 Too Many Requests`.
   - Cắt nhỏ tin nhắn an toàn (chunking ~3800 ký tự).
7. **Chụp ảnh màn hình Desktop (`/screen`):**
   - Gọi trực tiếp công cụ hệ thống `/usr/bin/gnome-screenshot` trên Linux Mint và gửi ảnh tức thì qua `sendPhoto`.
8. **Realtime Notifications:**
   - Lắng nghe sự kiện từ `orchestrator` và `transcriptWatcher`: thông báo bắt đầu phase, hoàn thành phase (keyword `"Done skul9x."`), lỗi xảy ra.

---

## 3. DANH SÁCH LỆNH TELEGRAM BOT

| Lệnh | Mô tả |
| :--- | :--- |
| **`/start`** | Khởi động bot, hiển thị menu lệnh và kiểm tra quyền truy cập (whitelist) |
| **`/plans` hoặc `/plan_start`** | Quét thư mục plan và mở menu chọn thư mục -> chọn chế độ chạy |
| **`/plan_status`** | Xem tiến độ hiện tại (Phase đang chạy, % hoàn thành, trạng thái) |
| **`/plan_skip`** | Bỏ qua phase hiện tại (`autoplan.skipPhase`) |
| **`/plan_stop`** | Dừng khẩn cấp automation (`autoplan.stop`) |
| **`/new_chat`** | Mở một cuộc hội thoại mới trong Antigravity IDE (`Ctrl+Shift+L`) |
| **`/screen`** | Chụp ảnh màn hình máy tính gửi về Telegram |
| **`<chat bất kỳ>`** | Bơm prompt trực tiếp vào ô chat của Antigravity IDE và stream kết quả |

---

## 4. BƯỚC TIẾP THEO
→ Thực thi `/plan` để thiết kế chi tiết kiến trúc code, schema cấu hình và danh sách task thực hiện.
