# Performance Audit Report - 2026-09-08

## Summary
- 🔴 Critical Issues: 3
- 🟡 Warnings: 4
- 🟢 Suggestions: 3

Phạm vi khám: **Performance Focus** (Chuyên khoa Hiệu năng: Tốc độ xử lý, Rò rỉ tài nguyên, Nghẽn đĩa/I/O, Lag giao diện Electron & Extension Host).

---

## 🔴 Critical Issues (Bệnh nặng - Phải đại phẫu ngay)

### 1. Bão quét DOM đệ quy (`querySelectorAll('*')`) và MutationObserver toàn cục làm nghẽn CPU Electron
- **File**: `media/autoplan-dom-bridge.js` (Dòng 204-224, 2045, 2135-2141)
- **Triệu chứng kỹ thuật**:
  - `MutationObserver` lắng nghe trên `document.body` của toàn bộ cửa sổ IDE với cấu hình `{ childList: true, subtree: true }`. Trong VS Code / Antigravity, hàng nghìn DOM node thay đổi liên tục (con trỏ nhấp nháy, gõ code, minimap, terminal output).
  - Mỗi khi scan duyệt nút bấm dialog (`scanAndApprove`), nếu bộ chọn tìm kiếm không ra kết quả (99% thời gian là không có dialog), nó nhảy vào nhánh fallback và thực thi `container.querySelectorAll('*')` trên toàn bộ cây DOM hàng chục nghìn element của VS Code, sau đó duyệt từng element để soi `shadowRoot` và `iframe`.
- **Nguy hiểm (Ngôn ngữ đời thường)**:
  - Giống như việc mỗi khi có một chiếc lá rơi ngoài sân, bảo vệ lại chạy đi lật tung từng viên gạch trong toàn bộ tòa nhà để tìm xem có trộm không.
  - Hậu quả: Quạt tản nhiệt quay ầm ầm, máy tính ngốn pin khủng khiếp, người dùng gõ code bị giật cục (typing latency) và giao diện VS Code bị tụt khung hình nghiêm trọng.
- **Phác đồ điều trị**:
  1. Giới hạn `MutationObserver` chỉ theo dõi các container chứa thông báo/hộp thoại (như `.notifications-toasts`, `.monaco-dialog-box`).
  2. Triệt tiêu hoàn toàn lệnh `querySelectorAll('*')`; chỉ tìm đúng các selector nút bấm cụ thể với giới hạn độ sâu.
  3. Áp dụng debounce/throttle thông minh: kéo dài chu kỳ thăm dò từ 50ms lên 800ms - 1000ms khi không có tín hiệu dialog.

---

### 2. Đọc đồng bộ toàn bộ file Transcript (`readFileSync` + `split('\n')`) làm đóng băng Extension Host Thread
- **File**: `src/transcriptWatcher.ts` (Dòng 927-936)
- **Triệu chứng kỹ thuật**:
  ```typescript
  const content = fs.readFileSync(filePath, 'utf8');
  const slice = this.readOffset > 0 ? content.slice(0, this.readOffset) : content;
  const lines = slice.split('\n').filter(l => l.trim().length > 0);
  this.initialTranscriptLength = lines.length;
  ```
  File `transcript.jsonl` hoặc `transcript_full.jsonl` trong Antigravity IDE thường xuyên phình to từ 10MB đến hơn 100MB (chứa mã nguồn các file, hình ảnh chụp màn hình, kết quả tool call). Lệnh `fs.readFileSync` đọc toàn bộ file vào bộ nhớ rồi băm `.split('\n')` đồng bộ ngay trên luồng chính (Main Thread) của Extension Host.
- **Nguy hiểm (Ngôn ngữ đời thường)**:
  - Giống như việc bắt nhân viên thu ngân dừng phục vụ toàn bộ khách hàng đang xếp hàng chỉ để ngồi đếm từng trang trong một cuốn từ điển dày cộp.
  - Hậu quả: VS Code sẽ hiện popup cảnh báo: *"The extension host is unresponsive"*. Toàn bộ tính năng tự động gợi ý code (autocomplete), phím tắt, định dạng văn bản của lập trình viên bị đơ cứng tạm thời.
- **Phác đồ điều trị**:
  1. Không đọc toàn bộ nội dung file transcript vào RAM.
  2. Đếm số dòng bằng Stream bất đồng bộ (`fs.createReadStream`) đọc từng chunk 64KB và đếm ký tự `\n` (Buffer scan) mà không cấp phát mảng chuỗi khổng lồ.
  3. Chuyển 100% sang hàm bất đồng bộ non-blocking.

---

### 3. Bão I/O ổ đĩa trong vòng lặp Polling (`getCandidateConversationsAsync`) do thiếu bộ nhớ Cache
- **File**: `src/transcriptWatcher.ts` (Dòng 241-337, 703-723, 903)
- **Triệu chứng kỹ thuật**:
  - Mỗi 300ms (hoặc 50ms khi test), hệ thống lặp qua toàn bộ thư mục trong `~/.gemini/antigravity-ide/brain/`. Nếu người dùng đã dùng IDE nhiều tuần và có hàng trăm thư mục conversation, hàm gọi hàng trăm lệnh `stat` trên từng thư mục và từng file transcript.
  - Biến `brainDirCacheMap` (dòng 88) đã được khai báo nhưng hoàn toàn bị bỏ quên, không được ghi đè hay tận dụng.
  - Tương tự, `initializeBaselineCandidates()` gọi `fs.readdirSync` và `fs.statSync` đồng bộ trên hàng loạt thư mục mỗi khi một phase bắt đầu.
- **Nguy hiểm (Ngôn ngữ đời thường)**:
  - Ổ cứng bị tra tấn đọc/ghi thông tin file liên tục hàng trăm lần mỗi giây dù không có cuộc trò chuyện mới nào.
  - Hậu quả: Làm nghẽn hàng đợi I/O của hệ điều hành, làm các bài test bị timeout sau 8000ms (như lỗi vừa gặp ở Phase 05 test).
- **Phác đồ điều trị**:
  1. Lọc trước các thư mục dựa trên danh sách mtime hoặc sử dụng `fs.watch` trên thư mục `brain/` để chỉ quét khi có folder mới xuất hiện.
  2. Kích hoạt bộ nhớ đệm (Cache) kiểm tra mtime của thư mục gốc trước khi quét chi tiết từng folder con.

---

## 🟡 Warnings (Bệnh trung bình - Nên điều trị sớm)

### 1. Khởi tạo tiến trình con đồng bộ (`execSync`) liên tiếp gây giật lag luồng xử lý
- **File**: `src/keyboardManager.ts` (Dòng 133, 138, 141, 150, 276)
- **Chi tiết**:
  - Hàm `inspectLinuxActiveWindow()` mang danh là `async` nhưng bên trong lại gọi liên tiếp 4 lệnh `execSync` (`xdotool getactivewindow`, `xdotool getwindowname`, `xdotool getwindowpid`, `ps -p`).
  - Hàm `checkLinuxKeyboardPrerequisites()` chạy `execSync('which xdotool')` mỗi khi kiểm tra độ sẵn sàng của dispatcher mà không lưu lại kết quả.
- **Nguy hiểm**: Mỗi lần spawn process trên Linux tốn 20-50ms CPU time. 4 lệnh liên tiếp làm luồng Extension Host bị đóng băng từ 100-200ms.
- **Khuyến nghị**: Gộp thành một chuỗi lệnh shell duy nhất hoặc chuyển sang `execFile` bất đồng bộ; đồng thời cache kết quả kiểm tra `which xdotool` sau lần chạy đầu tiên.

### 2. Biên dịch C# động qua PowerShell `Add-Type` trên Windows gây trễ 2 giây
- **File**: `src/keyboardManager.ts` (Dòng 205-224)
- **Chi tiết**: Mỗi lần kiểm tra cửa sổ active trên Windows, script PowerShell nhúng mã nguồn C# và gọi trình biên dịch Roslyn (`Add-Type @' using System; ... '@;`) để biên dịch lại từ đầu.
- **Nguy hiểm**: Gây trễ từ 1.5s đến 2.5s mỗi khi chuẩn bị gửi phím tắt hoặc kiểm tra cửa sổ IDE.
- **Khuyến nghị**: Tránh dùng `Add-Type` lặp lại nhiều lần. Có thể dùng các lệnh Win32 trực tiếp của PowerShell hoặc biên dịch sẵn một lần duy nhất.

### 3. Quét đệ quy toàn bộ thư mục cài đặt VS Code (`findFileRecursive` maxDepth 6)
- **File**: `src/workbenchInjector.ts` (Dòng 57-79, 134, 140)
- **Chi tiết**: Khi không tìm thấy `workbench.html` ở vị trí mặc định, hàm sẽ duyệt đệ quy toàn bộ thư mục `appRoot` (chứa hàng chục nghìn file) tới độ sâu 6 tầng bằng `fs.readdirSync`.
- **Nguy hiểm**: Gây treo Extension Host từ 2 đến 5 giây nếu người dùng mở dự án lớn hoặc dùng bản VS Code có nhiều module.
- **Khuyến nghị**: Loại bỏ việc quét đệ quy vô điều kiện; chỉ tìm trong các thư mục đích được định nghĩa trước (whitelist) và sử dụng API bất đồng bộ.

### 4. Tái tạo toàn bộ cây DOM của Webview Sidebar mỗi khi cập nhật trạng thái
- **File**: `media/sidebar/sidebar.js` (Dòng 185)
- **Chi tiết**: Mỗi khi nhận sự kiện `stateUpdate`, hàm `renderPhaseList` thực hiện `phaseList.innerHTML = ''` và dựng lại toàn bộ danh sách phase từ đầu kèm các event listener.
- **Nguy hiểm**: Gây chớp giật giao diện thanh bên (UI flickering) và tạo nhiều rác bộ nhớ cho trình thu gom rác (Garbage Collector).
- **Khuyến nghị**: Cập nhật trực tiếp trên các phần tử DOM đã có (DOM diffing / update by index) thay vì xóa trắng toàn bộ `innerHTML`.

---

## 🟢 Suggestions (Tối ưu nâng cao)

1. **Thay thế `Array.shift()` bằng Circular Ring Buffer**:
   - Trong `DebugLogger.ts` và `SidebarProvider.ts`, việc dùng `shift()` khi mảng đạt tối đa 500-1000 phần tử tốn chi phí O(N) do phải dời chỗ toàn bộ phần tử trong mảng. Chuyển sang cấu trúc Ring Buffer với con trỏ xoay vòng sẽ đạt hiệu năng O(1).
2. **Gom gói tin IPC (Batching & Debounce)**:
   - Gom các cập nhật tiến độ (progress bar, log feed) bằng `requestAnimationFrame` hoặc debounce 100ms trước khi gửi `postMessage` sang Webview để giảm tần suất serialization JSON.
3. **Lazy Scan cho thư mục Kế hoạch (`plans/`)**:
   - Chỉ đếm số lượng phase khi người dùng thực sự hover hoặc bấm vào danh sách chọn, không quét trước toàn bộ các thư mục con trong workspace lúc khởi động.

---

## Phác đồ điều trị đề xuất (Action Plan)
1. 🚀 **Trị dứt điểm bão CPU DOM Bridge**: Giới hạn vùng quan sát của `MutationObserver` và loại bỏ `querySelectorAll('*')`.
2. ⚡ **Giải phóng Event Loop cho Transcript Watcher**: Thay `readFileSync` + `split` bằng bộ đếm dòng Buffer Stream bất đồng bộ dung lượng nhẹ.
3. 💾 **Tối ưu hóa đĩa cứng**: Kích hoạt bộ nhớ đệm Cache và chỉ kiểm tra mtime các cuộc trò chuyện mới hơn `sinceTimestamp`.
