# 💡 BRIEF: Antigravity Auto-Plan Automation Extension

**Ngày tạo:** 2026-08-27  
**Mục tiêu:** Tự động hóa chuỗi hội thoại lặp lại trong Antigravity IDE (Ctrl + Shift + L -> Gửi prompt -> Chờ Agent trả về `Done skul9x.` -> Lặp lại 5 lần).

---

## 1. VẤN ĐỀ CẦN GIẢI QUYẾT
- Khi cần chạy nhiều task/plan nối tiếp nhau (batch tasking) trong Antigravity IDE, người dùng phải ngồi trực máy:
  1. Đợi task trước chạy xong (khi Agent báo `Done skul9x.`).
  2. Bấm phím tắt `Ctrl + Shift + L` để mở conversation mới.
  3. Copy và paste prompt tiếp theo rồi nhấn gửi.
  4. Lặp lại thao tác này thủ công nhiều lần tốn thời gian và gián đoạn công việc.

---

## 2. GIẢI PHÁP ĐỀ XUẤT
Tạo **Auto-Plan Extension** (hoặc Runner Tool tích hợp trực tiếp vào Antigravity IDE / VS Code) với cơ chế:
1. **Trigger & Phím tắt**: Kích hoạt lệnh `Ctrl + Shift + L` (qua VS Code Command API hoặc OS Key Simulator) để khởi tạo cuộc trò chuyện mới.
2. **Auto Paste & Send**: Tự động đưa nội dung prompt vào và gửi tin nhắn đi.
3. **Log/Transcript Watcher (Siêu ổn định)**: Lắng nghe thư mục log transcript của Antigravity (`~/.gemini/antigravity-ide/brain/*/.system_generated/logs/transcript.jsonl`) để phát hiện tức thì và chính xác 100% khi nào Agent xuất tín hiệu `Done skul9x.`.
4. **Vòng lặp & Cấu hình**: Đếm số lần chạy (mặc định 5 lần hoặc cho phép nhập số lần / danh sách prompt khác nhau cho từng lượt).

---

## 3. CÁC PHƯƠNG ÁN KIẾN TRÚC KỸ THUẬT

### 🌟 Phương án 1: VSCode Extension Native (Khuyên dùng)
- **Cơ chế**: Cài trực tiếp vào Antigravity IDE (do Antigravity chạy trên nền tảng VSCode).
- **Giao diện**: Có nút bấm trên Status Bar (thanh dưới cùng) hoặc Sidebar UI: "Start Auto Loop (5/5)".
- **Ưu điểm**: Nhẹ, mượt mà, tích hợp 100% vào IDE, có thể cấu hình danh sách prompt trực tiếp trong settings.

### ⚙️ Phương án 2: Python / Node.js Sidecar Automation Tool
- **Cơ chế**: Một script chạy nền điều khiển phím/chuột qua OS API (`pyautogui` / `robotjs`) kết hợp theo dõi log Antigravity.
- **Ưu điểm**: Độc lập, không phụ thuộc vào version của Extension Host.

---

## 4. TÍNH NĂNG CHI TIẾT

### 🚀 MVP (Bắt buộc có):
- [ ] Giao diện/Lệnh khởi động chu trình lặp (mặc định 5 vòng).
- [ ] Cấu hình đoạn prompt text mẫu cần gửi.
- [ ] Tự động tạo conversation mới (`Ctrl + Shift + L`).
- [ ] Tự động gửi prompt và bắt đầu chờ.
- [ ] Module giám sát phản hồi: Bắt từ khóa `"Done skul9x."` từ Agent.
- [ ] Tự động chuyển vòng tiếp theo ngay khi nhận được tín hiệu cho đến khi đủ 5 lần.
- [ ] Thông báo (Notification / Sound) khi hoàn tất toàn bộ 5 lần.

### 🎁 Phase 2 (Nâng cao):
- [ ] Cho phép nạp danh sách 5 prompt khác nhau (VD: Task 1 -> Task 2 -> Task 3...).
- [ ] Nút Stop / Pause khẩn cấp bất cứ lúc nào.
- [ ] Timeout an toàn (nếu quá X phút không thấy Agent trả lời thì báo lỗi/dừng).

---

## 5. ƯỚC TÍNH SƠ BỘ
- **Độ phức tạp:** Trung bình (khoảng 1-2 ngày hoàn thiện full test).
- **Điểm mấu chốt:** Cơ chế phát hiện Agent phản hồi thông qua Transcript File Watcher đảm bảo độ chính xác 100%, không bị ảnh hưởng bởi lag màn hình hay UI rendering.

---

## 6. BƯỚC TIẾP THEO
→ Chạy `/plan` để lập kế hoạch chi tiết từng file, kiến trúc module và flow thực thi.
