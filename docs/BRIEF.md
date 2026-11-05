# 💡 BRIEF: Nudge Watchdog Deactivation, Single-Leader Telegram Delivery & Clean Single-Message Streaming

**Ngày tạo:** 2026-11-05  
**Phiên bản dự kiến:** v1.7.4  
**Brainstorm cùng:** skul9x (User)

---

## 1. VẤN ĐỀ CẦN GIẢI QUYẾT

1. **Prompt Nudge tự động khó chịu sau 3 phút:**
   - Trong quá trình thực thi phase, sau 180s (3 phút) extension tự động inject prompt:  
     `"Search online to find the best practices. Note, do not open a browser and directly access the DOM. Use search_web / read_url_content when you need to look something up."`  
   - Điều này làm gián đoạn luồng tư duy tự nhiên của AI và gây nhiễu context chat.
2. **Nhân đôi tin nhắn "Live Progress" trên Telegram Bot:**
   - Người dùng thấy 2 container tin nhắn `🔄 Live Progress: [Phase ...]` xuất hiện cùng lúc trên Telegram.
   - Nguyên nhân chính:
     - **Multi-Window / Standby Leaks:** Khi mở nhiều cửa sổ IDE hoặc reload window, chỉ có polling loop của bot có Leader Election, còn `ThrottledNotifier` và `TranscriptWatcher` ở cửa sổ Standby vẫn gắn listener và gọi Telegram API `sendMessage` / `safeSendMessage` độc lập tới cùng Chat ID!
     - **Unbounded Creation:** `ThrottledNotifier.flushThrottleBuffer()` không có cơ chế khóa đơn lẻ theo Leader role (`getIsLeader()`) hoặc đồng bộ `liveMessageIds` tập trung.
3. **Nhiễu notification trong lúc AI làm việc:**
   - Người dùng muốn trải nghiệm tinh gọn: Trong lúc AI đang xử lý, Telegram Bot chỉ hiển thị trạng thái `typing...` (không spam tin nhắn sửa liên tục gây phân tâm), và chỉ gửi đúng **1 tin nhắn kết quả hoàn chỉnh** khi AI hoàn tất.

---

## 2. GIẢI PHÁP ĐỀ XUẤT

1. **Vô hiệu hóa hoàn toàn Mid-Flight Nudge Watchdog:**
   - Đặt `autoplan.longPhaseNudgeEnabled` thành `false` làm giá trị mặc định trong `package.json` và `src/config.ts`.
   - Vô hiệu hóa việc tự inject prompt `"Search online to find the best practices..."` và dừng thông báo Nudge sang Telegram.
2. **Triệt tiêu nhân đôi Live Message bằng Leader Gating (Single-Leader Policy):**
   - Ràng buộc mọi thao tác gửi tin nhắn của `ThrottledNotifier` và `TelegramChatMirror`: Chỉ instance giữ vai trò **Leader** (`telegramBridge.getIsLeader() === true`) mới được phép gọi Telegram Bot API gửi/sửa tin nhắn.
   - Các instance Standby (cửa sổ thứ 2 trở đi hoặc window phụ) sẽ hoạt động ở chế độ im lặng (Muted Standby), không tạo thêm Live Message hay gửi trùng lặp.
3. **Chế độ Clean Single-Message Final Result & Typing Indicator:**
   - Cung cấp tùy chọn cấu hình `autoplan.telegram.liveProgressMode`:
     - `'final_only'` (Mặc định mới theo mong muốn của User): Trong suốt quá trình thực thi, duy trì typing indicator `sendChatAction('typing')`. Khi hoàn tất phase hoặc toàn bộ kế hoạch, gửi 1 tin nhắn kết quả cuối cùng (Rich HTML).
     - `'live_edit'`: Chế độ thanh tiến độ cũ (1 message duy nhất được edit liên tục, bảo đảm không bị nhân đôi).
   - Bảo đảm dọn dẹp sạch sẽ (finalize/unpin) mọi message tạm khi phase kết thúc hoặc bị hủy.

---

## 3. ĐỐI TƯỢNG SỬ DỤNG
- **Người dùng chính:** Lập trình viên sử dụng Auto-Plan Extension trên Antigravity IDE kết hợp giám sát và điều khiển từ xa qua Telegram Bot.
- **Môi trường:** Đơn hoặc Đa cửa sổ IDE (Multi-window / Multi-root workspace trên PC).

---

## 4. TÍNH NĂNG (SCOPE)

### 🚀 MVP (Bắt buộc hoàn thành ngay):
- [ ] **Config Update:** Chuyển `autoplan.longPhaseNudgeEnabled` default = `false` trong `package.json` và `src/config.ts`. Đảm bảo không còn auto-nudge sau 3 phút.
- [ ] **Leader Gating cho Notifier & Mirror:** Tích hợp kiểm tra `isLeader` trước khi `ThrottledNotifier.flushThrottleBuffer()`, `broadcastMessage()`, `sendInfo()`, `safeSendMessage()`. Instance không phải leader sẽ bị drop/skip gửi ra Telegram.
- [ ] **Clean Final-Only Delivery Mode:** Hỗ trợ gửi duy nhất 1 tin nhắn kết quả cuối cùng khi xong phase/task, giữ trạng thái `typing...` trong khi xử lý mà không tạo live message thừa.
- [ ] **Deduplication Lock:** Đảm bảo mỗi chat ID chỉ có tối đa 1 Live Message ID duy nhất tại một thời điểm, loại bỏ triệt để hiện tượng nhân đôi tin nhắn.

### 🎁 Phase 2 (Nâng cấp thêm):
- [ ] Cho phép tùy chỉnh bật/tắt giữa `final_only` và `live_edit` trực tiếp trên Sidebar Webview / Settings Dashboard.
- [ ] Tự động dọn (deleteMessage) placeholder cũ khi chuyển sang phase mới.

---

## 5. ƯỚC TÍNH SƠ BỘ
- **Độ phức tạp:** Trung bình (Tập trung refactor logic `telegramNotifier.ts`, `telegramBridge.ts`, `orchestrator.ts`, `config.ts`).
- **Rủi ro:** Cần đảm bảo các unit test hiện có cho Notifier và Watchdog vẫn tương thích khi bật cờ tùy chọn.

---

## 6. BƯỚC TIẾP THEO
→ Chuyển sang workflow `/plan` để lập kế hoạch chi tiết (chia phases, viết test cases và triển khai code).
