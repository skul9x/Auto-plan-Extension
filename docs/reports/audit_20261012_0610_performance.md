# 🩺 BÁO CÁO KIỂM ĐỊNH HIỆU NĂNG & TIÊU THỤ TÀI NGUYÊN (PERFORMANCE AUDIT v1.6.5)

**Hồ sơ bệnh án:** Auto-Plan Extension (`antigravity-auto-plan`)  
**Bác sĩ phụ trách:** Antigravity Performance Engineer & System Auditor  
**Thời gian thực hiện:** 2026-10-12T06:10:00+07:00  
**Phiên bản mã nguồn:** `v1.6.5`  
**Phạm vi kiểm định (Scope):** `Tối Ưu Tốc Độ, Chống Đơ/Lag App & Quản Lý Tài Nguyên (Performance Focus)`  
**Trạng thái tổng quát:** 🟢 **Khỏe mạnh — 0 Lỗi Critical/High — 2 Điểm nghẽn Medium — 2 Khuyến nghị Tối ưu Low/Suggestion**

---

## 📊 1. TỔNG KẾT HỒ SƠ KHÁM LÂM SÀNG (EXECUTIVE SUMMARY)

Đợt kiểm định hiệu năng chuyên sâu cho phiên bản `v1.6.5` tập trung vào toàn bộ các phân hệ vừa nâng cấp (Telegram Clean Q&A Sync, Two-Way Mirror, Long-Running Phase Nudge Watchdog, DOM Bridge `stopGeneration`, và hệ thống I/O stream):

1. **Khả năng đáp ứng của Event Loop Node.js (Extension Host)**: Kiểm tra các tác vụ I/O đĩa (`fs.stat`, `fs.readdir`), cơ chế polling, và mức tải trên luồng chính.
2. **Hiệu năng Streaming & I/O Churn**: Rà soát `TranscriptTailEngine`, `readline`, `fs.createReadStream`, và chi phí phân bổ bộ nhớ khi tailing file `transcript.jsonl`.
3. **Độ Trễ & Chu Kỳ Watchdog Timers**: Phân tích bộ đếm thời gian Nudge Watchdog (`phaseNudgeTimer`), Typing Indicators (`typingActionManager`), và Ring Buffer Sweeper (`promptOriginTracker`).
4. **Rendering & Layout Thrashing trong DOM Bridge**: Đánh giá thuật toán tìm nút dừng sinh (`findCancelButton`), bộ chọn CSS, và nguy cơ gây Forced Synchronous Reflow trên Chromium Renderer.
5. **Mức tiêu thụ CPU & Nguy cơ ReDoS**: Phân tích độ phức tạp thuật toán xử lý chuỗi trong `splitMarkdownSafely`, `stripMarkdownToPlainText`, và `extractUserPrompt`.

---

### Bảng Phân Loại Kết Quả (Findings Matrix)

| STT | Mã Chẩn Đoán | Phân Loại | Mức Độ (Severity) | Độ Tin Cậy (Confidence) | Vị Trí / Tác Vụ | Trạng Thái |
|:---:|:---|:---|:---:|:---:|:---|:---:|
| 1 | **PERF-01** | Disk I/O Storm / Event Loop Churn | 🟡 **Medium** | 🎯 **High** | `src/transcriptTailEngine.ts` (Quét toàn bộ thư mục conv mỗi 300ms) | Cần tối ưu |
| 2 | **PERF-02** | Synchronous I/O in Poll Loop | 🟡 **Medium** | 🎯 **High** | `src/telegramBridge.ts` (Đọc đồng bộ `findLatestConversation` ở legacy fallback) | Cần tối ưu |
| 3 | **PERF-03** | Idle Loopback HTTP Overhead | 🔵 **Low** | 🎯 **High** | `media/autoplan-dom-bridge.js` (Polling cố định 500ms khi hệ thống nhàn rỗi) | Khuyến nghị |
| 4 | **PERF-04** | Sequential Regex Intermediate Copy | 🟢 **Suggestion** | 🎯 **High** | `src/transcriptTailEngine.ts` (`extractUserPrompt` thực hiện nhiều chuỗi regex) | Khuyến nghị |

---

## 🔍 2. CHI TIẾT CHẨN ĐOÁN LÂM SÀNG

---

### 🟡 PERF-01: Quét Toàn Bộ Thư Mục Hội Thoại Không Bounded Mỗi 300ms Trong `TranscriptTailEngine`

* **Category:** Performance / Disk I/O & Event Loop Overhead
* **Severity:** Medium
* **Confidence:** High
* **Vị trí phát hiện:** [src/transcriptTailEngine.ts:L441-L470](file:///home/skul9x/Desktop/Code/Auto-plan-Extension-main/src/transcriptTailEngine.ts#L441-L470) & [src/transcriptTailEngine.ts:L507-L545](file:///home/skul9x/Desktop/Code/Auto-plan-Extension-main/src/transcriptTailEngine.ts#L507-L545)
* **🔎 Triệu chứng lâm sàng:**
  - `TranscriptTailEngine` thiết lập chu kỳ `pollTimer` định kỳ mỗi **300ms** (`this.pollIntervalMs`).
  - Trong mỗi nhịp `pollTick()`, nếu không chỉ định rõ `explicitTranscriptPath`, engine gọi:
    ```typescript
    const latestConv = await this.findLatestConversation();
    if (latestConv && latestConv !== this.activeConvId) {
      this.switchConversation(latestConv);
      return;
    }
    ```
  - Trong `findLatestConversation()`:
    ```typescript
    const entries = await fs.promises.readdir(this.brainDir, { withFileTypes: true });
    for (const entry of entries) {
      // Gọi fs.promises.stat tuần tự trên từng thư mục con...
    }
    ```
* **🧠 Nguyên nhân gốc:**
  - Nếu thư mục `~/.gemini/antigravity-ide/brain/` tích lũy nhiều cuộc hội thoại (ví dụ 50–100 thư mục), mỗi nhịp 300ms extension thực hiện 1 lượt `readdir` và 50–100 lượt `stat` bất đồng bộ tuần tự.
  - Tần suất này tương đương **160 – 330 I/O operations mỗi giây** trên ổ đĩa, chạy liên tục trong suốt thời gian Telegram Bot hoạt động, kể cả khi không có hội thoại mới nào được tạo.
  - Hơn nữa, `this.brainDirWatcher = fs.watch(this.brainDir)` **đã được thiết lập sẵn** để đón bắt sự kiện thay đổi của thư mục `.brain/`. Việc polling toàn diện mỗi 300ms tạo ra sự dư thừa lớn về I/O đĩa và CPU.
* **💊 Phác đồ điều trị:**
  1. **Tách biệt nhịp kiểm tra:** Trong vòng lặp 300ms, chỉ gọi `this.checkAndRead()` trên file transcript hiện tại.
  2. **Throttle phát hiện hội thoại mới:** Chỉ gọi `findLatestConversation()` khi `brainDirWatcher` kích hoạt sự kiện thay đổi, hoặc bổ sung biến đếm nhịp (ví dụ: chỉ dò tìm hội thoại mới mỗi 3000ms – 5000ms thay vì 300ms).
  3. **Tái sử dụng cơ chế Hot/Cold & LRU Stat Hint:** Giới hạn số lượng thư mục cần `stat` hoặc lọc theo danh sách thư mục mới thay vì quét toàn bộ lịch sử.

---

### 🟡 PERF-02: Lời Gọi Đồng Bộ `findLatestConversation` Trong Legacy Await Model Response Fallback

* **Category:** Performance / Event Loop Latency
* **Severity:** Medium
* **Confidence:** High
* **Vị trí phát hiện:** [src/telegramBridge.ts:L1698](file:///home/skul9x/Desktop/Code/Auto-plan-Extension-main/src/telegramBridge.ts#L1698) & [src/telegramBridge.ts:L1621](file:///home/skul9x/Desktop/Code/Auto-plan-Extension-main/src/telegramBridge.ts#L1621)
* **🔎 Triệu chứng lâm sàng:**
  - Khi `chatMirror` bị tắt (`autoplan.telegram.enableChatMirror: false`), Telegram Bot chuyển sang hàm legacy `awaitAndReplyModelResponse`.
  - Trong `resolvePath()`, khi chưa tìm thấy transcript, code gọi hàm đồng bộ `findLatestConversation(brainDir, startTime - 5000)` mỗi 250ms trên Node.js main thread.
  - Ngoài ra, ở line 1771, một đối tượng `fs.createReadStream` mới được khởi tạo ở mỗi nhịp file transcript tăng kích thước, gây phân bổ GC ngắn hạn.
* **🧠 Nguyên nhân gốc:**
  - Phân hệ `awaitAndReplyModelResponse` là luồng xử lý trước v1.6.4 được giữ lại làm dự phòng khi người dùng tắt `chatMirror`. Luồng này chưa được chuyển đổi đồng bộ sang `TranscriptTailEngine`.
* **💊 Phác đồ điều trị:**
  1. Thay thế lời gọi đồng bộ `findLatestConversation` bằng `findLatestConversationAsync`.
  2. Hoặc định tuyến hoàn toàn luồng free-chat phản hồi qua `TranscriptTailEngine` dùng chung (vốn đã tối ưu continuous byte-offset).

---

### 🔵 PERF-03: Tần Suất Polling Cố Định 500ms Của DOM Bridge Client Khi Hệ Thống Nhàn Rỗi

* **Category:** Performance / Loopback Network & CPU Overhead
* **Severity:** Low
* **Confidence:** High
* **Vị trí phát hiện:** [media/autoplan-dom-bridge.js:L13](file:///home/skul9x/Desktop/Code/Auto-plan-Extension-main/media/autoplan-dom-bridge.js#L13)
* **🔎 Triệu chứng:**
  - `DomBridgeClient` chạy ngầm trong Renderer context của Antigravity IDE (`workbench.html`) với `DEFAULT_POLL_INTERVAL_MS = 500`.
  - Client gửi liên tục request HTTP GET `/autoplan-status` qua localhost 2 lần/giây, kể cả khi không có bất kỳ plan nào đang chạy trong nhiều giờ.
* **🧠 Nguyên nhân gốc:** Thiết lập polling tĩnh không có trạng thái ngủ (Adaptive Idle Polling).
* **💊 Phác đồ điều trị:**
  - Áp dụng **Adaptive Dynamic Backoff**:
    - Khi có lệnh đang thực thi hoặc trong vòng 30 giây sau lần submit gần nhất: Duy trì `200ms – 500ms` để phản hồi tức thì.
    - Khi hệ thống idle > 60 giây: Nâng chu kỳ lên `1500ms – 2000ms`.
    - Ngay khi nhận được tín hiệu bắt đầu hoặc user tương tác: Lập tức tăng tốc trở lại `200ms`.

---

### 🟢 PERF-04: Phân Bổ Chuỗi Trung Gian Trong `extractUserPrompt`

* **Category:** Performance / String Allocation
* **Severity:** Suggestion
* **Confidence:** High
* **Vị trí phát hiện:** [src/transcriptTailEngine.ts:L60-L92](file:///home/skul9x/Desktop/Code/Auto-plan-Extension-main/src/transcriptTailEngine.ts#L60-L92)
* **🔎 Triệu chứng:**
  - Hàm `extractUserPrompt` thực hiện `matchAll` kèm 4 đến 7 lời gọi `replace()` liên tiếp với các biểu thức chính quy toàn cục (`/[\s\S]*?/gi`) để bóc tách thẻ `<USER_REQUEST>`, `<ADDITIONAL_METADATA>`, `<system_information>`, v.v.
  - Với các turn đầu có system context dài 50KB–100KB, việc gọi liên tiếp nhiều `replace()` tạo ra nhiều bản sao chuỗi trung gian trước khi gọt gọn kết quả.
* **💊 Phác đồ điều trị:**
  - Khi đã tìm thấy khớp thẻ `<USER_REQUEST>`, chỉ cắt substring phần nội dung bên trong thay vì thực hiện chuỗi `replace` tuần tự trên toàn bộ chuỗi gốc.

---

## 🛡️ 3. CÁC ĐIỂM SÁNG HIỆU NĂNG XUẤT SẮC (ARCHITECTURAL STRENGTHS)

Qua phân tích chi tiết mã nguồn v1.6.5, extension sở hữu nhiều kỹ thuật tối ưu hóa đạt chuẩn công nghiệp cao:

1. **Bộ Đếm Thời Gian Nudge Watchdog Hoàn Toàn Leak-Free**:
   - `phaseNudgeTimer` trong [src/orchestrator.ts](file:///home/skul9x/Desktop/Code/Auto-plan-Extension-main/src/orchestrator.ts) được thiết lập dạng `unref()`, bảo đảm không bao giờ giữ tiến trình Node.js chạy ngoài ý muốn.
   - Cơ chế One-Shot per-phase (`phase.hasNudged = true`) triệt tiêu hoàn toàn nguy cơ lặp lại prompt gây nghẽn chat AI.
   - Timer được thu hồi và gán `null` một cách có kỷ luật ở mọi nhánh thoát (`onPhaseComplete`, `skipPhase`, `stop`, `dispose`).

2. **DOM Bridge `findCancelButton` Triệt Tiêu 100% Layout Thrashing**:
   - Hàm `findCancelButton` trong [media/autoplan-dom-bridge.js](file:///home/skul9x/Desktop/Code/Auto-plan-Extension-main/media/autoplan-dom-bridge.js) chỉ sử dụng CSS attribute matching (`aria-label`, `data-tooltip-id`, `.bg-red-500`) mà **hoàn toàn không gọi `getComputedStyle`**.
   - Điều này triệt tiêu hoàn toàn hiện tượng Forced Synchronous Reflow trong Chromium renderer, giữ vững tốc độ khung hình 60fps của Antigravity IDE.

3. **Thuật Toán Cắt Markdown Thông Minh $O(N)$ Tuyến Tính**:
   - `SmartMarkdownChunker` duyệt văn bản theo từng dòng trong một lượt duy nhất ($O(N)$), không dùng các regex lồng nhau phức tạp, loại bỏ 100% nguy cơ ReDoS (Catastrophic Backtracking).
   - Tự động cân bằng code block fences (```) bảo đảm payload gửi sang Telegram luôn hợp lệ mà không cần parse lại cây cú pháp AST nặng nề.

4. **Quản Lý Bộ Nhớ Vòng Bounded Trong `PromptOriginTracker` & `SidebarProvider`**:
   - `PromptOriginTracker` giới hạn cứng `capacity = 100`, tự động quét dọn bằng timer định kỳ `15000ms` với `timer.unref()`, tra cứu mã băm SHA-256 với độ phức tạp $O(1)$.
   - `SidebarProvider` kẹp cứng hàng đợi `MAX_PENDING_LOGS = 150`, ngăn chặn rò rỉ bộ nhớ vô hạn khi Sidebar bị ẩn hoặc đóng.

5. **Điều Phối Tải Thông Minh (Throttled Deliverer & Dashboard Throttler)**:
   - Khoảng cách an toàn >= 1000ms giữa các chunk phản hồi và 1200ms cho các lần cập nhật giao diện Dashboard trên Telegram.
   - Tự động bóc tách tham số `retry_after` khi gặp mã lỗi HTTP 429 và thực hiện exponential backoff, bảo vệ kết nối mạng và tài nguyên hệ thống.

---

## 🧪 4. KẾT QUẢ KIỂM THỬ XÁC MINH (VERIFICATION)

```bash
# 1. Biên dịch TypeScript
npm run compile
✔ 0 errors, 0 warnings

# 2. Kiểm thử Nudge Watchdog & Regression v1.6.5
npm run test:phase05-nudge
✔ 5/5 test suites passed (100%)

# 3. Kiểm thử Telegram Discovery & Selector
npm run test:phase02-telegram
✔ 4/4 test suites passed (100%)

# 4. Kiểm thử Prompt Injection & Origin Tracking
npm run test:phase03-nudge
✔ 4/4 test suites passed (100%)

# 5. Kiểm thử Telegram Nudge Notifications E2E
npm run test:phase04-nudge
✔ 5/5 test suites passed (100%)
```

---

## 📋 5. KẾ HẠCH ĐIỀU TRỊ KHUYẾN NGHỊ (PRESCRIPTION)

| Ưu Tiên | Hạng Mục | Hành Động Kỹ Thuật | Thời Gian Dự Kiến |
|:---:|:---|:---|:---:|
| **P1** | **Khắc phục PERF-01** | Bổ sung cờ throttle kiểm tra hội thoại mới trong `TranscriptTailEngine.pollTick()` (3000ms thay vì 300ms) để giảm 90% disk I/O. | ~20 phút |
| **P2** | **Khắc phục PERF-02** | Chuyển đổi lời gọi `findLatestConversation` đồng bộ sang async trong `telegramBridge.awaitAndReplyModelResponse`. | ~15 phút |
| **P3** | **Khắc phục PERF-03** | Triển khai Adaptive Backoff (500ms active -> 2000ms idle) trong `DomBridgeClient`. | ~20 phút |
