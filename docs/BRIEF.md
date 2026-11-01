# 💡 BRIEF: DOM Bridge Chat Injection Hardening & Two-Phase Verification Diagnostics

**Ngày tạo:** 2026-11-01  
**Mục tiêu:** Khắc phục triệt để lỗi không paste được prompt vào khung chat của Antigravity IDE, loại bỏ "ảo giác thành công" (false positive submit), nâng cấp hệ thống debug log và cơ chế kiểm chứng (Two-Phase Buffer Verification) theo chuẩn UI automation quốc tế.

---

## 1. VẤN ĐỀ CẦN GIẢI QUYẾT (ROOT CAUSE & PROBLEM STATEMENT)

Qua phân tích log thực tế trên Antigravity IDE 1.107 (Electron 39 / Node 22.21), phát hiện 3 lỗ hổng nghiêm trọng khiến extension không paste được prompt nhưng vẫn báo "thành công 100%":

1. **Bắt nhầm mục tiêu (Target Misidentification):**
   - Khi khung chat Agent chưa mở hoặc chưa mount kịp, selector trong hàm `findChatInput()` trượt xuống selector dự phòng cuối cùng là `[role="textbox"]`.
   - Selector này vô tình bắt trúng `<div class="native-edit-context" role="textbox">` — đây là phần tử xử lý phím ẩn của **Monaco Code Editor** (tab file mã nguồn đang mở), hoàn toàn không phải khung chat.
2. **"Paste mù" không có Post-Paste Verification:**
   - Tại Step 2 (`Content injection`), extension gán `inputElem.innerText = promptText` và lập tức đánh dấu `status: "success"` mà **không hề đọc lại DOM** để kiểm tra text có thực sự nằm trong buffer hay không. Trình duyệt Electron/Chromium phớt lờ lệnh gán text lên `.native-edit-context`, nên prompt không bao giờ xuất hiện.
3. **Lỗ hổng kiểm chứng giả ("Proof 1" False Positive):**
   - Khi chuyển sang Step 4 (`Submit triggering`), hàm `isInputClearedOrSubmitted()` kiểm tra xem input có rỗng không:
     `if (!rawText) return true;`
   - Vì phần tử code editor vốn dĩ rỗng text từ đầu, hàm lập tức kết luận sai lầm: *"Input rỗng, chứng tỏ prompt đã được gửi và xóa sạch ngay tức thì!"* (`input_cleared_immediately` trong 0ms).
4. **Debug log thiếu thông tin danh tính phần tử (Semantic Blindness):**
   - Log chỉ ghi `tagName: "DIV", className: "native-edit-context"` mà không ghi rõ container cha (`closest`), `placeholder`, `aria-label`, kích thước hiển thị (`boundingClientRect`) hay số ký tự thực tế phát hiện được trong DOM sau khi paste (`charsDetectedInDOM`).

---

## 2. GIẢI PHÁP ĐỀ XUẤT (PROPOSED ARCHITECTURE)

Áp dụng chuẩn Best Practices từ E2E UI Automation (Playwright / Cypress / Chrome DevTools Protocol) và kiến trúc DOM Bridge:

```
[Target Discovery] ──► [Pre-Paste Check] ──► [Injection] ──► [Post-Paste DOM Verification]
        │                                                                │
        ▼ (Nếu là Code Editor / Ngoài Chat Panel)                       ▼ (Nếu actualChars === 0)
   [REJECT / RETRY]                                              [PASTE_VERIFICATION_FAILED]
                                                                 (DỪNG NGAY, KHÔNG BẤM SUBMIT)
```

1. **Scoping & Exclusion Engine:**
   - **Scope giới hạn:** Chỉ tìm kiếm input bên trong container của Agent Panel: `#antigravity.agentSidePanelInputBox`, `div[data-lexical-editor="true"]`, `div[aria-label="Message input"]`, `.chat-widget`.
   - **Exclusion Filter:** Chủ động loại trừ các phần tử thuộc `.monaco-editor` của editor group chính (code tabs), ngăn chặn tuyệt đối việc bắt nhầm `.native-edit-context`.
2. **Two-Phase Buffer Verification (Kiểm tra 2 thì):**
   - Đọc DOM trước và sau khi gán/paste text (`charsExpected` vs `charsDetectedInDOM`).
   - Nếu sau injection mà độ dài text trong DOM = 0 hoặc không khớp với sample prompt -> Ném lỗi `PASTE_VERIFICATION_FAILED`, ghi log chi tiết và **dừng lại ngay lập tức**, cấm không được chuyển sang bước bấm nút Send hoặc giả lập phím Enter.
3. **Chữa lỗi State Transition cho Proof 1 (No Content = No Clearance):**
   - Chỉ công nhận trạng thái `input_cleared` nếu trước đó phần tử đã được xác nhận chứa đầy đủ nội dung prompt (`hasVerifiedContent === true`). Nếu buffer rỗng ngay từ đầu, coi đó là trạng thái lỗi, không phải là đã submit thành công.
4. **Nâng cấp Debug Telemetry & Semantic Fingerprinting:**
   - Log rõ ràng: `charsExpected`, `charsDetectedInDOM`, `domExcerpt` (50 ký tự đầu của text thực tế trong DOM), `isInChatPanel: boolean`, `containerId`, `boundingBox` (width, height).

---

## 3. ĐỐI TƯỢNG SỬ DỤNG
- Người dùng Auto-Plan Extension trên Antigravity IDE (VS Code Fork) chạy trên Linux/macOS/Windows.
- Các quy trình tự động hóa chạy batch nhiều phase, điều khiển từ xa qua Telegram hoặc chạy background yêu cầu độ tin cậy tuyệt đối khi đẩy prompt vào khung chat.

---

## 4. PHÂN TÍCH SO SÁNH GIẢI PHÁP

| Tiêu chí | Cơ chế hiện tại (V1.7.0) | Cơ chế mới đề xuất (Hardened Two-Phase) |
|---|---|---|
| **Chọn phần tử input** | Dễ bắt nhầm tab code qua `[role="textbox"]` | 🟢 Khóa chặt trong container `#antigravity.agentSidePanelInputBox`, loại trừ code editor |
| **Kiểm tra sau khi paste** | Không có (Mặc định gán xong là success) | 🟢 Đọc lại DOM, so khớp `charsDetectedInDOM` với `charsExpected` |
| **Bảo vệ Submit** | Submit mù kể cả khi paste thất bại | 🟢 Ngăn chặn submit nếu bước paste không qua được verification |
| **Độ chính xác Proof 1** | Lỗi False Positive (Rỗng từ đầu = Cleared) | 🟢 Bắt buộc có chuyển đổi trạng thái: `Có dữ liệu -> Rỗng` |
| **Chẩn đoán khi có lỗi** | Không biết đã paste thành công hay chưa | 🟢 Cung cấp log telemetry chi tiết: số ký tự DOM, excerpt, container context |

---

## 5. DANH SÁCH TÍNH NĂNG (FEATURE BREAKDOWN)

### 🚀 MVP (Bắt buộc có):
- [ ] **Hardened Chat Input Discovery (`findChatInput` in `media/autoplan-dom-bridge.js`):**
  - Loại bỏ selector tự do `[role="textbox"]`.
  - Khóa chặt selector ưu tiên: `#antigravity.agentSidePanelInputBox [contenteditable="true"]`, `div[data-lexical-editor="true"]`, `div[aria-label="Message input"]`.
  - Thêm bộ lọc kiểm tra: `!el.closest('.monaco-workbench .part.editor')`.
- [ ] **Hàm Post-Paste Buffer Verification (`verifyBufferHasText`):**
  - Đọc text thực tế qua `innerText` / `textContent` / `value`.
  - So khớp mẫu substring và độ dài tối thiểu.
- [ ] **Chặn đứng luồng Submit nếu Paste thất bại (`injectPromptAndSubmit`):**
  - Thêm bước kiểm tra ngay sau Step 2.
  - Báo lỗi `PASTE_VERIFICATION_FAILED` và dừng quy trình nếu DOM không nhận text.
- [ ] **Sửa đổi logic Proof 1 trong `isInputClearedOrSubmitted` & `verifyInputSubmission`:**
  - Bổ sung biến trạng thái `hasConfirmedContentBeforeSubmit`. Buffer rỗng ngay từ đầu sẽ trả về `false`.
- [ ] **Nâng cấp Debug Telemetry trong Client & Server Logs:**
  - Cập nhật payload log của `Step 1` và `Step 2` với thông tin semantic: `charsExpected`, `charsDetectedInDOM`, `domExcerpt`, `isInChatPanel`.
- [ ] **Bộ Test hồi quy (Unit & Integration Tests):**
  - Test case: Giả lập element code editor rỗng -> Verify hệ thống từ chối và báo lỗi `PASTE_VERIFICATION_FAILED`.
  - Test case: Giả lập Lexical chat container nhận text -> Verify pass cả 2 thì (paste và cleared).

### 🎁 Phase 2 (Nâng cao & Mở rộng):
- [ ] **Tự động kích hoạt mở khung chat (Auto-Reveal Chat Fallback):**
  - Nếu quét không thấy khung chat, tự động dispatch `workbench.action.chat.open` và đợi 500ms trước khi retry tìm input.
- [ ] **Clipboard / Native Synthetic Paste Strategy:**
  - Bổ sung fallback dispatch sự kiện `paste` mô phỏng `ClipboardEvent` nếu gán `innerText` bị chặn bởi Lexical editor state.
- [ ] **DOM Visual Snapshot Snippet on Failure:**
  - Tự động trích xuất 300 ký tự HTML của vùng chứa khi paste thất bại và đính kèm vào Diagnostic Report.

---

## 6. ƯỚC TÍNH SƠ BỘ & ĐÁNH GIÁ RỦI RO
- **Độ phức tạp:** Trung bình (Sửa đổi tập trung tại `media/autoplan-dom-bridge.js`, `src/promptDispatcher.ts`, và cập nhật test suite).
- **Rủi ro kỹ thuật:**
  - *Rủi ro:* Một số phiên bản Antigravity IDE có thể dùng class CSS khác nhau cho chat container.
  - *Giải pháp:* Hỗ trợ fallback cascade có thứ tự ưu tiên (ưu tiên selector chuyên biệt của Antigravity Lexical, sau đó đến standard VS Code Chat).

---

## 7. BƯỚC TIẾP THEO
→ Chạy `/plan` để lập kế hoạch chi tiết từng phase triển khai kỹ thuật và viết test hồi quy.
