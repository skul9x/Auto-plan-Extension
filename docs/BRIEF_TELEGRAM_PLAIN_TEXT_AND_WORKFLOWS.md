# 💡 BRIEF: Telegram Plain Text Output & Workflow Slash Autocomplete

**Ngày tạo:** 2026-10-11  
**Tác giả & Brainstorm cùng:** skul9x & Antigravity  
**Phạm vi:** Nâng cấp module Telegram Bridge (`src/telegramBridge.ts`, `src/telegramUtils.ts`) trong extension Auto-Plan.

---

## 1. MỤC TIÊU CỐT LÕI

1. **Clean Plain Text Output**:
   - Toàn bộ kết quả AI trả về từ transcript và gửi sang Telegram Bot sẽ được gọt sạch 100% các cú pháp Markdown (`**`, `#`, `__`, `~~`, `` ` ``, tables `|---|---|`, link markdown).
   - Không sử dụng HTML hay bất kỳ `parse_mode` nào, chỉ gửi Plain Text thuần túy, sạch sẽ, thoáng mắt, dễ đọc trên màn hình điện thoại và miễn nhiễm 100% với lỗi parsing của Telegram API.
   - Bảng Markdown được dàn phẳng thành các dòng gạch đầu dòng rõ ràng, khối code được giữ nguyên thụt dòng tự nhiên.

2. **Workflows Slash Autocomplete (`/`)**:
   - Khi người dùng gõ `/` trong ứng dụng Telegram, menu autocomplete bật lên danh sách các Workflows của Antigravity IDE để chọn nhanh (gõ tắt).
   - Danh sách được đăng ký tự động qua `bot.api.setMyCommands`.
   - Chuẩn hóa tên lệnh tuân thủ quy tắc Telegram (`[a-z0-9_]`), chuyển các lệnh có dấu `-` (như `/save-brain`, `/awf-update`, `/cloudflare-tunnel`) thành `_` (`/save_brain`, `/awf_update`, `/cloudflare_tunnel`).
   - Bot tự động map ngược lại dấu `-` khi dispatch vào Antigravity IDE.
   - Cho phép người dùng gõ kèm tham số hoặc nội dung bất kỳ đằng sau lệnh (ví dụ: `/brainstorm làm ứng dụng hẹn giờ`, `/code tạo hàm login`, `/plan thêm tính năng giỏ hàng`).

---

## 2. KIẾN TRÚC & CƠ CHẾ KỸ THUẬT

### 2.1. Bộ gọt Markdown sang Plain Text (`stripMarkdownToPlainText`)
Xây dựng hàm xử lý văn bản chuyên dụng trong `src/telegramUtils.ts`:
- **Headings (`#`, `##`, `###`)**: Bỏ dấu thăng, giữ nguyên text tiêu đề hoặc viết hoa.
- **Bold/Italic/Underline/Strike (`**`, `*`, `__`, `_`, `~~`)**: Loại bỏ các ký tự bọc, giữ lại nội dung văn bản.
- **Inline Code (`` `code` ``)**: Bỏ dấu backtick.
- **Fenced Code Blocks (````lang\ncode\n````)**: Giữ lại khối code nguyên bản với thụt dòng, bỏ hàng rào backtick.
- **Markdown Links (`[Title](url)`)**: Chuyển thành `Title` (nếu link là `file://`) hoặc `Title (url)` (nếu là web url).
- **Markdown Tables (`| Col 1 | Col 2 |`)**: Tách từng hàng thành định dạng danh sách dễ đọc trên mobile:
  ```text
  • Col 1: Col 2
  ```
- **Blockquotes (`> Quote`)**: Chuyển thành dòng trích dẫn sạch.

### 2.2. Danh sách Commands trên Telegram (`setMyCommands`)
Đăng ký qua `bot.api.setMyCommands`:
```typescript
[
  // 1. AWF Core Workflows
  { command: 'init', description: '✨ Khởi tạo dự án mới' },
  { command: 'brainstorm', description: '💡 Bàn ý tưởng, research tính năng' },
  { command: 'plan', description: '📋 Lên kế hoạch tính năng chi tiết' },
  { command: 'design', description: '🎨 Thiết kế kỹ thuật (DB, API, Flow)' },
  { command: 'visualize', description: '🖼️ Thiết kế UI/UX mockup' },
  { command: 'code', description: '💻 Viết code theo Spec' },
  { command: 'run', description: '▶️ Chạy ứng dụng' },
  { command: 'debug', description: '🐛 Chẩn đoán và sửa lỗi' },
  { command: 'test', description: '🧪 Chạy kiểm thử tự động' },
  { command: 'audit', description: '🔒 Kiểm tra bảo mật & hiệu năng' },
  { command: 'deploy', description: '🚀 Deploy lên production' },
  { command: 'next', description: '➡️ Gợi ý bước tiếp theo' },
  { command: 'recap', description: '📖 Khôi phục ngữ cảnh làm việc' },
  { command: 'help', description: '❓ Trợ giúp & hướng dẫn' },
  { command: 'review', description: '👀 Đánh giá & review code' },
  { command: 'refactor', description: '🔧 Tái cấu trúc mã nguồn' },
  { command: 'save_brain', description: '🧠 Lưu kiến thức dự án vào .brain/' },
  { command: 'customize', description: '⚙️ Cá nhân hóa trải nghiệm AI' },
  { command: 'rollback', description: '⏪ Quay lại phiên bản cũ' },
  { command: 'awf_update', description: '📦 Cập nhật framework AWF' },

  // 2. Bot System Controls
  { command: 'plans', description: '📂 Xem và chọn plan thực thi' },
  { command: 'plan_status', description: '📊 Xem tiến độ và thanh progress bar' },
  { command: 'plan_stop', description: '🛑 Dừng khẩn cấp automation' },
  { command: 'plan_skip', description: '⏭️ Bỏ qua phase hiện tại' },
  { command: 'screen', description: '📸 Chụp ảnh màn hình IDE' },
  { command: 'new_chat', description: '💬 Mở phiên hội thoại mới' }
]
```

### 2.3. Bộ chuyển đổi lệnh (Command Normalizer & Dispatcher)
Khi nhận tin nhắn text từ người dùng:
1. Nếu bắt đầu bằng `/`:
   - Lấy tên lệnh: ví dụ `/save_brain`, `/awf_update`.
   - Nếu nằm trong danh sách lệnh alias có gạch dưới: tự động đổi thành `/save-brain`, `/awf-update` (chuẩn IDE).
   - Ghép với phần nội dung người dùng gõ thêm đằng sau (nếu có): ví dụ `/brainstorm làm app quản lý chi tiêu`.
2. Bơm toàn bộ chuỗi hoàn chỉnh vào `promptDispatcher.dispatchPrompt(normalizedText)`.
3. Khi nhận kết quả transcript từ IDE:
   - Chạy qua `stripMarkdownToPlainText(rawResult)`.
   - Cắt nhỏ an toàn (`splitMessage` ~3800 chars).
   - Gửi về Telegram không kèm parse_mode (`parse_mode: undefined`).

---

## 3. CHECKLIST KIỂM THỬ

- [ ] `stripMarkdownToPlainText` xử lý mượt mà mọi loại markdown (bold, italic, links, tables, code blocks).
- [ ] Bot khởi động tự động gọi `setMyCommands` thành công với Telegram API.
- [ ] Gõ `/` trên Telegram hiện đầy đủ danh sách workflows với icon và mô tả.
- [ ] Gửi `/save_brain` được chuyển thành `/save-brain` vào IDE.
- [ ] Gửi `/brainstorm <nội dung>` chuyển tiếp đầy đủ cả lệnh lẫn nội dung vào IDE.
- [ ] Tin nhắn phản hồi trả về Telegram hiển thị dạng plain text 100%, không dính cú pháp markdown thô, không lỗi font.

---

## 4. BƯỚC TIẾP THEO
→ Chuyển sang `/plan` để lên kế hoạch triển khai chi tiết từng phase code và test.
