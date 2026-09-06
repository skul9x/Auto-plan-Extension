# Handover Document - Auto-Plan Extension

**Date:** 2026-08-30T10:25:00+07:00  
**Version:** v1.4.0  
**Status:** ✅ Stable & Zero Warnings

---

## 📍 Đang làm & Trạng thái hiện tại
- **Kế hoạch vừa hoàn thành:** `plans/260830-1015-dep0169-url-parse-and-async-plan-scanner/` (3/3 phases completed).
- **Tình trạng:** Toàn bộ test suite pass 100%, không còn cảnh báo `[DEP0169]`, không còn hiện tượng gửi đúp prompt.

---

## ✅ ĐÃ XONG:
1. **WHATWG URL Migration (`src/bridgeServer.ts`):**
   - Thay thế hoàn toàn `url.parse(req.url, true)` bằng `new URL(req.url || '', 'http://127.0.0.1')`.
   - Triệt tiêu 100% cảnh báo `[DEP0169] DeprecationWarning` trên Node.js 20+ (VS Code runtime).
2. **Asynchronous Plan Scanner Migration (`src/planScanner.ts`, `src/orchestrator.ts`, `src/extension.ts`):**
   - Chuyển đổi toàn bộ `orchestrator.startPlanFolder` và `findActivePlanFolderAsync` sang `scanPlanFolderAsync`.
   - Gắn cờ `@deprecated` cho hàm đồng bộ cũ `scanPlanFolder`.
3. **Sửa lỗi Double Click / Gửi đúp Prompt (`media/autoplan-dom-bridge.js`):**
   - Loại bỏ sự kiện `click` nhân tạo bị phát thừa sau khi gọi `button.click()`.
   - Đảm bảo cơ chế submit loại trừ (mutually exclusive) duy nhất: `buttonClick` -> `enterKey` -> `formSubmit`.
   - Re-inject script mới vào `workbench.html`.
4. **End-to-End Regression Test Suite:**
   - Tạo `src/test/phase03_dep0169_async_scanner_regression.test.ts` với global `process.on('warning')` trap.
   - Thêm script `npm run test:dep0169` vào `package.json`.

---

## ⏳ CÒN LẠI / TIẾP THEO:
- Không còn blocker hay pending task kỹ thuật tồn đọng.
- Dự án sẵn sàng để đóng gói release hoặc tiếp tục mở rộng tính năng mới theo nhu cầu.

---

## 🔧 QUYẾT ĐỊNH QUAN TRỌNG:
- **HTTP URL Parsing:** Dùng WHATWG `new URL()` chuẩn thay vì `url.parse`.
- **Submit Cascade:** Luôn ưu tiên native `button.click()` và không dispatch thêm synthetic click event.
- **Disk I/O:** Luôn dùng `scanPlanFolderAsync` trong mọi workflow để bảo vệ UI thread.

---

## 📁 FILES QUAN TRỌNG:
- `.brain/brain.json` (Static knowledge)
- `.brain/session.json` (Dynamic session state)
- `src/bridgeServer.ts` (HTTP Bridge Server with WHATWG URL)
- `src/orchestrator.ts` (Plan Orchestrator)
- `media/autoplan-dom-bridge.js` (DOM Bridge Client)
- `plans/260830-1015-dep0169-url-parse-and-async-plan-scanner/` (Plan files)

---
*Để khôi phục ngữ cảnh cho phiên làm việc tiếp theo, hãy gõ `/recap`.*
