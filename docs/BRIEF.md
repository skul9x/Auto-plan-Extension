# 💡 BRIEF: Chuyển đổi 100% Native Antigravity Chat API & Tinh gọn Giao diện (Remove Legacy Tiers)

**Ngày cập nhật:** 2026-11-04  
**Trạng thái:** Approved by User (Sẵn sàng triển khai `/plan`)  
**Mục tiêu:** Loại bỏ hoàn toàn kiến trúc 3 Tier cũ (DOM Bridge chèn `workbench.html`, lệnh ảo, giả lập phím OS `xdotool`/PowerShell). Thay thế bằng giải pháp Native API 100% của Google Antigravity (`antigravity.addContext` + `antigravity.triggerSend`), tối giản toàn bộ giao diện người dùng và mang lại độ ổn định tuyệt đối.

---

## 1. VẤN ĐỀ VÀ BỐI CẢNH (PROBLEM STATEMENT)

Hệ thống điều phối prompt trước đây của extension sử dụng kiến trúc 3 Tier phức tạp và tiềm ẩn nhiều rủi ro:
1. **Tier 1 (DOM Bridge):** 
   - Phải chèn đoạn mã script vào file cài đặt `workbench.html` của IDE, can thiệp vào mã nguồn gốc của ứng dụng.
   - Bị Chromium CSP và chính sách bảo mật Trusted Types (`TrustedScriptURL`) chặn Web Worker timer.
   - Gây cảnh báo mã hash/checksum của IDE, dễ bị hỏng hoặc mất tác dụng khi Antigravity IDE cập nhật phiên bản mới.
2. **Tier 2 (Native Command cũ):**
   - Phụ thuộc vào lệnh `antigravity.sendTextToChat` vốn **không tồn tại** trong Antigravity IDE, khiến Tier này luôn bị lỗi.
3. **Tier 3 (OS Keyboard Simulation):**
   - Sử dụng `xdotool` (Linux) hoặc `PowerShell SendKeys` (Windows) để gõ phím giả lập.
   - Bắt buộc phải cướp tiêu điểm cửa sổ (steal focus), dễ bị lệch phím, gõ nhầm vào tab khác nếu người dùng đang thao tác chuột hoặc bàn phím.
4. **Giao diện người dùng rườm rà (UI Overhead):**
   - Settings UI có tới 4 thẻ Tier lớn, các công tắc Fallback, nút 1-Click Setup, chẩn đoán phức tạp làm rối mắt người dùng.

---

## 2. GIẢI PHÁP ĐỀ XUẤT (THE 100% NATIVE API SOLUTION)

Tận dụng trực tiếp các lệnh nội bộ chính thức được Google xây dựng sẵn bên trong Antigravity IDE:

```
[Orchestrator / Telegram / Loop]
              │
              ▼
    [PromptDispatcher]
              │
              ├──► 1. (Nếu Phase mới) await vscode.commands.executeCommand('antigravity.startNewConversation')
              │    └──► Chờ 400ms để giao diện chat ổn định
              │
              ├──► 2. await vscode.commands.executeCommand('antigravity.addContext', promptText)
              │    └──► Đẩy text vào khung chat qua Protobuf RPC nội bộ
              │
              ├──► 3. Chờ 'sendDelayMs' (mặc định 500ms) để nút Send bật trạng thái hoạt động
              │
              └──► 4. await vscode.commands.executeCommand('antigravity.triggerSend')
                   └──► Kích hoạt lệnh gửi tin nhắn
```

### Ưu điểm vượt trội:
- **Độ tin cậy 100%:** Sử dụng API có sẵn của IDE, không lo bắt nhầm selector hay bị giao diện webview thay đổi.
- **An toàn tuyệt đối:** Không đụng vào `workbench.html`, không vi phạm CSP `TrustedScriptURL`, không cần quyền quản trị hệ thống (`sudo`/admin).
- **Hoạt động ngầm (True Background):** Không cướp tiêu điểm cửa sổ, người dùng có thể thoải mái làm việc khác trong lúc automation chạy.

---

## 3. CÁC QUYẾT ĐỊNH THIẾT KẾ ĐÃ THỐNG NHẤT (AGREED DESIGN DECISIONS)

1. **Loại bỏ hoàn toàn cơ chế chèn `workbench.html`:**
   - Xoá bỏ các lệnh tiêm script vào file hệ thống.
   - Bổ sung cơ chế tự động dọn sạch các thẻ chèn cũ trong `workbench.html` (nếu người dùng đã từng cài đặt trước đó) để khôi phục IDE về trạng thái nguyên bản sạch sẽ.
2. **Quy trình gửi prompt mỗi Phase:**
   - Mỗi Phase trong Plan sẽ tự động gọi `antigravity.startNewConversation` để bắt đầu ngữ cảnh mới.
   - Thêm thời gian chờ ổn định cố định **400ms** trước khi gọi `antigravity.addContext`.
3. **Cấu hình độ trễ gửi (Send Delay):**
   - Thêm cấu hình `autoplan.sendDelayMs` vào Settings (mặc định: `500` ms) để người dùng có thể tùy chỉnh nếu máy tính cấu hình yếu hoặc mạnh.
4. **Giao diện Cài đặt (Settings UI - Phương án A Tối giản):**
   - Thiết kế lại Tab "Dispatch & Tiers" thành tab **"Native Dispatch"** tinh gọn:
     - Badge trạng thái: `🟢 Antigravity Native Engine: Ready`.
     - Nút thử nghiệm: `[🧪 Test Send Prompt]` (gửi thử prompt mẫu ngay lập tức).
     - Trường nhập: `Send Delay (ms)` (input số, mặc định 500ms).
     - Xoá bỏ: 4 thẻ Tier cũ, Fallback toggle, Strict mode toggle, nút 1-Click DOM Bridge.
5. **Dọn dẹp Sidebar & Status Bar:**
   - Thay thế các badge/nút "DOM Bridge" trên Sidebar và Status Bar bằng thông tin hiển thị trạng thái của Native Engine.
6. **Xử lý mã nguồn cũ:**
   - Ngắt hoàn toàn luồng gọi `keyboardManager.ts` trong `PromptDispatcher`, nhưng vẫn giữ file này trong repo làm tài liệu tham khảo dự phòng.

---

## 4. PHẠM VI CÔNG VIỆC (SCOPE & TASKS)

### 🚀 Giai đoạn 1: Core Engine & Dispatcher Refactoring
- [ ] Cập nhật `src/config.ts`:
  - Thêm `sendDelayMs` (number, default: 500).
  - Deprecate các trường cũ: `executionMode`, `allowTierFallback`, `strictMode`, `bridgeTimeoutMs`.
- [ ] Tái cấu trúc `src/promptDispatcher.ts`:
  - Đơn giản hóa hàm `dispatchPrompt`: Chỉ gọi trực tiếp quy trình Native (`startNewConversation` $\rightarrow$ `addContext` $\rightarrow$ delay $\rightarrow$ `triggerSend`).
  - Đơn giản hóa `validateDispatchReadiness`: Luôn trả về `ready: true` nếu lệnh VS Code sẵn sàng.
  - Loại bỏ các bước thăm dò DOM client và vòng lặp fallback phức tạp.
- [ ] Cập nhật `src/orchestrator.ts`:
  - Đảm bảo các luồng `runPlanAsync`, `runLoop`, và `executeNudgeProcedure` tương thích mượt mà với Native Dispatcher.

### 🎨 Giai đoạn 2: UI & Settings Simplification
- [ ] Thiết kế lại `media/settings/settings.html`:
  - Thay đổi Tab "Dispatch & Tiers" thành "Native Dispatch".
  - Hiển thị thông tin phiên bản Native API và cấu hình `Send Delay (ms)`.
  - Giữ nút `Test Send Prompt`.
- [ ] Cập nhật `media/settings/settings.js`:
  - Xoá các event listener và logic xử lý thẻ Tier cũ, fallback toggle.
  - Kết nối nút `btnTestTier` với lệnh kiểm tra Native Dispatch mới.
- [ ] Tinh gọn Sidebar (`media/sidebar/sidebar.html`, `sidebar.js`, `src/sidebarProvider.ts`):
  - Chuyển `bridgeStatusBadge` thành trạng thái Native Engine.
  - Xoá nút "⚡ DOM Bridge" không còn cần thiết.
- [ ] Dọn dẹp Status Bar (`src/extension.ts`):
  - Hiển thị trạng thái Auto-Plan Native Engine đơn giản, thân thiện.

### 🧹 Giai đoạn 3: Dọn dẹp hệ thống & Tự động khôi phục `workbench.html`
- [ ] Bổ sung cơ chế tự động kiểm tra `workbench.html`: Nếu phát hiện thẻ tag bridge cũ, tự động gỡ bỏ để phục hồi file nguyên bản.
- [ ] Cập nhật `package.json`:
  - Cập nhật danh sách configuration properties và commands.

---

## 5. KẾ HOẠCH BƯỚC TIẾP THEO
Sau khi xem lại Brief này:
👉 Gõ `/plan` để AI lập kế hoạch triển khai chi tiết từng bước (Architecture, Checklist, Test plan) và bắt đầu code.
