# Antigravity Auto-Plan Runner

<p align="center">
  <img src="https://raw.githubusercontent.com/skul9x/Auto-plan-Extension/main/docs/assets/banner.png" alt="Antigravity Auto-Plan Runner" width="100%" onerror="this.style.display='none'"/>
</p>

<p align="center">
  <a href="https://github.com/skul9x/Auto-plan-Extension/releases"><img src="https://img.shields.io/badge/version-1.0.2-blue.svg?style=flat-square" alt="Version"></a>
  <a href="https://code.visualstudio.com/"><img src="https://img.shields.io/badge/VS%20Code-^1.80.0-informational.svg?style=flat-square" alt="VS Code Compatibility"></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-5.3.3-3178C6.svg?style=flat-square" alt="TypeScript"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-green.svg?style=flat-square" alt="License"></a>
</p>

---

## 📌 Giới Thiệu (Overview)

**Antigravity Auto-Plan Runner** (`antigravity-auto-plan`) là extension mạnh mẽ dành riêng cho **Antigravity IDE** và **Visual Studio Code**, giúp tự động hóa hoàn toàn quy trình thực thi các kế hoạch phát triển phần mềm chia theo từng phase (`phase-01-*.md`, `phase-02-*.md`,...).

Extension tự động quét thư mục plan, khởi tạo cuộc trò chuyện mới trong Antigravity IDE, render prompt động theo template, giám sát file transcript log JSONL theo thời gian thực để nhận diện tín hiệu hoàn thành của AI Agent (`"Done skul9x."`), sau đó chuyển tiếp tuần tự sang phase kế tiếp một cách mượt mà và tin cậy.

---

## ✨ Tính Năng Nổi Bật (Key Features)

### 1. 📁 Folder-Based Auto-Plan Automation
- Quét và tự động thực thi tuần tự các file kế hoạch (`phase-01-*.md`, `phase-02-*.md`,...).
- Sắp xếp thứ tự file thông minh theo chuẩn số học tự nhiên (**Natural Alphanumeric Sort** - đảm bảo `phase-2` luôn chạy trước `phase-10`).
- Tự động bỏ qua các file tài liệu tổng quan (`plan.md`, `summary.md`, `overview.md`, `walkthrough.md`, `README.md`).

### 2. 🎯 Smart 2-Step Interactive QuickPick & Custom Phase Selection
- **Step 1 - Smart Folder Selection**:
  - **Active Plan Detection**: Tự động phát hiện thư mục plan của file Markdown đang mở trong Editor.
  - **Workspace Auto-Discovery**: Quét và tự động gợi ý các thư mục con bên trong `plans/` của workspace (kèm cơ chế bộ nhớ đệm TTL 5s chống nghẽn I/O).
  - **Recent History**: Lưu lại danh sách các thư mục plan đã chạy gần đây.
  - **Native File Browser & Manual Input**: Hỗ trợ mở hộp thoại duyệt thư mục hệ điều hành hoặc gõ đường dẫn tuyệt đối trực tiếp.
- **Step 2 - Smart Phase Action Menu**:
  - ▶️ **Run all X phases**: Chạy tuần tự toàn bộ các phase từ đầu đến cuối.
  - ⚡ **Smart Resume**: Tự động lọc và chỉ chạy các phase chưa hoàn thành (`Pending` / `In Progress`), tự động bỏ qua các phase đã `Completed` / `Done`.
  - 🎯 **Select custom phases...**: Mở bảng chọn Interactive Multi-Select QuickPick để chủ động chọn các phase muốn chạy kèm các nút tiện ích (*Select All*, *Select Pending*, *Invert Selection*).
  - 📍 **Run from specific phase...**: Chọn điểm bắt đầu và tự động chạy tiếp tất cả các phase nối tiếp từ vị trí đã chọn.

### 3. ⚡ Tự Động Hóa Bàn Phím Đơn Lệnh (Batch Keyboard Flow)
- Gửi phím tắt `Ctrl + Shift + L` mở phiên New Conversation trong Antigravity IDE.
- Sử dụng mô hình **Single PowerShell Execution** (tận dụng `WScript.Shell` qua COM & `Start-Sleep`) kết hợp nạp Clipboard in-process an toàn tuyệt đối.
- Tự động bôi đen (`Ctrl + A`), dán prompt (`Ctrl + V`) và nhấn gửi (`Enter`).
- Hỗ trợ tùy chỉnh độ trễ chờ focus (`autoplan.focusDelayMs`) tối ưu cho từng cấu hình máy.

### 4. 👁️ Strict JSONL Transcript Watcher & Real-time Stream Parser
- Giám sát thư mục `~/.gemini/antigravity-ide/brain/` và file logs `transcript.jsonl`.
- Cơ chế đọc bù phần tăng trưởng (**Byte Offset Tracking**), hạn chế đọc lại toàn bộ file log dung lượng lớn.
- **Stream Decoder & Guard**: Bộ đệm chunk chống ngắt quãng chuỗi UTF-8 đa byte và dòng JSON bị phân mảnh.
- Bộ lọc nhận diện nghiêm ngặt: Phân biệt chính xác giữa `USER_INPUT` (lệnh gửi từ user) và `PLANNER_RESPONSE` / `MODEL` (câu trả lời của Agent), loại bỏ hoàn toàn tình trạng kích hoạt sớm do false-positive.

### 5. 📊 Interactive Status Bar & Action Menu
- Hiển thị trực quan tiến trình thời gian thực ngay dưới thanh trạng thái:  
  `$(sync~spin) Auto-Plan: [2/5] phase-02-watcher.md` hoặc `$(sync~spin) Auto-Plan: [1/3] (Custom) phase-03-api.md`
- Markdown Tooltip chi tiết hiển thị: Folder Name, Tiến độ phần trăm, Phase hiện tại, Trạng thái & Thời gian chạy (Elapsed Time).
- **Running Action Menu**: Click vào Status Bar khi đang chạy để:
  - 🛑 **Stop Auto-Plan**: Hủy quy trình ngay lập tức.
  - ⏭️ **Skip Current Phase**: Bỏ qua phase hiện tại và chuyển sang phase tiếp theo trong danh sách đã chọn.
  - 📄 **Open Active Transcript Log**: Mở file `transcript.jsonl` hiện tại trong editor để xem AI đang làm gì.

### 6. 📝 Dynamic Prompt Template Engine
- Hỗ trợ các biến placeholder động: `{xxx}`, `{path}`, `{file}`, `{phasePath}`, `{phaseFile}`.
- Tự động chuẩn hóa đường dẫn file theo định dạng chuẩn forward-slash (`/`), tương thích hoàn hảo trên Windows, Linux và macOS.

---

## 🔄 Sơ Đồ Quy Trình Hoạt Động (Workflow)

```mermaid
flowchart TD
    A([Start: autoplan.start]) --> B[Step 1: Chọn Plan Folder]
    B --> C[Smart Scanner: Quét & Phân tích Trạng thái Phase]
    C --> D{Step 2: Chọn Chế độ Thực thi}
    D -- Run All --> E[Tất cả các Phase]
    D -- Smart Resume --> F[Lọc Phase Pending & In Progress]
    D -- Select Custom --> G[Multi-Select QuickPick]
    D -- Run From --> H[Chọn Phase bắt đầu -> Chạy tiếp]
    E --> I[Khởi tạo Orchestrator]
    F --> I
    G --> I
    H --> I
    I --> J[Lấy Phase kế tiếp từ danh sách chọn]
    J --> K[Render Prompt Template với {xxx}]
    K --> L[Gửi phím tắt Ctrl+Shift+L mở Conversation]
    L --> M[Dán Prompt & Gửi Enter]
    M --> N[Transcript Watcher: Lắng nghe transcript.jsonl]
    N --> O{Nhận từ khóa 'Done skul9x.'?}
    O -- Chưa / Timeout? --> N
    O -- Đạt yêu cầu --> P{Còn Phase trong danh sách?}
    P -- Còn --> Q[Delay nghỉ giữa các phase]
    Q --> J
    P -- Hết --> R([🎉 Hoàn thành danh sách đã chọn])
```

---

## 📦 Hướng Dẫn Cài Đặt (Installation)

### Cách 1: Cài đặt qua giao diện Antigravity IDE / VS Code
1. Mở **Antigravity IDE** hoặc **VS Code**.
2. Nhấn `Ctrl + Shift + X` để mở bảng **Extensions**.
3. Nhấp vào biểu tượng dấu ba chấm (`...`) ở góc trên bên phải panel Extensions.
4. Chọn **Install from VSIX...**.
5. Chọn file `antigravity-auto-plan-1.0.1.vsix`.

### Cách 2: Cài đặt thông qua Command Line (CLI)
```bash
# Cài đặt vào Antigravity IDE
antigravity --install-extension antigravity-auto-plan-1.0.1.vsix

# Hoặc cài đặt vào VS Code chuẩn
code --install-extension antigravity-auto-plan-1.0.1.vsix
```

---

## 🚀 Hướng Dẫn Sử Dụng Chi Tiết (User Guide)

### 1. Chuẩn Bị Cấu Trúc Thư Mục Plan
Tạo thư mục plan với các file Markdown theo quy ước đánh số thứ tự:
```text
my-project/
├── plans/
│   └── 260828-0020-auth-feature/
│       ├── plan.md                       (Bị bỏ qua - file tổng quan)
│       ├── phase-01-database-schema.md   (Status: ✅ Completed)
│       ├── phase-02-auth-api.md          (Status: 🔄 In Progress)
│       ├── phase-03-frontend-ui.md       (Status: ⬜ Pending)
│       └── phase-04-integration-test.md  (Status: ⬜ Pending)
```

### 2. Bắt Đầu Tự Động Hóa (2-Step Flow)
1. Nhấn `Ctrl + Shift + P` (hoặc `F1`), gõ `Auto-Plan: Start Automation` (hoặc nhấp chuột vào nút **`$(rocket) Auto-Plan`** ở Status Bar góc dưới cùng bên phải).
2. **Bước 1 - Chọn thư mục plan**:
   - ⭐ **Active Plan**: Thư mục chứa file markdown bạn đang xem.
   - 📁 **Workspace Plans**: Các thư mục con tìm thấy trong `plans/`.
   - 🕒 **Recent Plans**: Lịch sử các plan đã chạy gần đây.
   - 📂 **Browse Folder from Disk...**: Chọn thư mục bất kỳ trên máy.
3. **Bước 2 - Chọn hành động thực thi**:
   - **▶️ Run all 4 phases**: Chạy trọn vẹn từ phase 1 đến 4.
   - **⚡ Smart Resume (3 remaining)**: Tự động phát hiện phase 1 đã xong và chỉ chạy tiếp từ phase 2 đến 4.
   - **🎯 Select custom phases...**: Tích chọn thủ công từng phase cụ thể cần chạy trong danh sách QuickPick đa nhiệm.
   - **📍 Run from specific phase...**: Chọn 1 phase làm mốc (ví dụ phase 3) để chạy từ phase 3 đến hết.

### 3. Kiểm Soát Khi Đang Chạy
Khi quy trình đang chạy, nhấp vào Status Bar `$(sync~spin) Auto-Plan: [X/Y] ...` để mở menu điều khiển:
- **Stop Auto-Plan**: Dừng tiến trình ngay lập tức.
- **Skip Current Phase**: Nhảy cóc qua phase hiện tại nếu agent gặp bế tắc.
- **Open Active Transcript Log**: Mở file `transcript.jsonl` tương ứng để theo dõi trực tiếp output của AI.

---

## 📝 Cú Pháp Prompt Template Động (Prompt Template Engine)

Bạn có thể tùy biến cấu trúc prompt gửi cho AI qua setting `autoplan.promptTemplate` hoặc `autoplan.defaultPromptTemplate`.

### Bảng Placeholder Hỗ Trợ:
| Placeholder | Ý Nghĩa | Ví Dụ Giá Trị Render |
|---|---|---|
| `{xxx}` | Đường dẫn tuyệt đối chuẩn hóa của file phase hiện tại | `D:/projects/app/plans/phase-01-init.md` |
| `{path}` / `{phasePath}` | Tương đương `{xxx}` | `D:/projects/app/plans/phase-01-init.md` |
| `{file}` / `{phaseFile}` | Tên file phase hiện tại | `phase-01-init.md` |

### Mẫu Prompt Chuẩn Khuyến Nghị:
```text
Implement the code closely following the file {xxx}
Note, follow the requirements exactly. Do only what is asked, with no extra work. Once done, you must thoroughly test what you have just implemented using exactly one file-based test for this phase. The test must verify the core functionality of the entire phase as comprehensively as reasonably possible. Do not create or run any additional tests, test cases, or test files. After finishing, mark the phase plan file as completed. When done, say "Done skul9x." to save token.
```

---

## ⚙️ Bảng Cấu Hình Chi Tiết (Settings Reference)

Mở **Settings (`Ctrl + ,`)** và tìm kiếm `autoplan`:

| Cài Đặt | Kiểu Dữ Liệu | Mặc Định | Mô Tả Chi Tiết |
|---|---|---|---|
| `autoplan.defaultPromptTemplate` | `string` | *(Mẫu chuẩn)* | Mẫu prompt mặc định cho từng phase chứa `{xxx}` / `{path}` / `{file}` |
| `autoplan.promptTemplate` | `string` | *(Mẫu chuẩn)* | Mẫu prompt tùy chỉnh của người dùng |
| `autoplan.promptText` | `string` | `"Done skul9x."` | Nội dung prompt tĩnh (khi chạy ở chế độ lặp đơn giản) |
| `autoplan.completionKeyword` | `string` | `"Done skul9x."` | Từ khóa chính xác trong phản hồi của Agent để xác nhận hoàn tất |
| `autoplan.delayBetweenLoopsMs` | `number` | `2000` | Thời gian chờ (mili-giây) giữa các phase trước khi mở New Conversation |
| `autoplan.timeoutPerLoopMinutes` | `number` | `15` | Thời gian timeout tối đa cho mỗi phase (phút) |
| `autoplan.focusDelayMs` | `number` | `800` | Thời gian chờ (mili-giây) sau `Ctrl+Shift+L` để khung chat focus hoàn toàn |
| `autoplan.defaultPlanFolder` | `string` | `""` | Đường dẫn thư mục plan mặc định |
| `autoplan.repeatCount` | `number` | `5` | Số lần lặp lại trong chế độ prompt tĩnh |

---

## 🔧 Danh Sách Lệnh (Command Palette Reference)

| Command ID | Title | Mô Tả Chức Năng |
|---|---|---|
| `autoplan.start` | `Auto-Plan: Start Automation` | Mở QuickPick chọn thư mục plan và bắt đầu thực thi |
| `autoplan.stop` | `Auto-Plan: Stop Automation` | Dừng quy trình chạy tự động ngay lập tức |
| `autoplan.skipPhase` | `Auto-Plan: Skip Current Phase` | Bỏ qua phase hiện tại và tiến sang phase kế tiếp |
| `autoplan.actionMenu` | `Auto-Plan: Show Running Action Menu` | Mở Action QuickPick khi đang chạy (Stop / Skip / View Log) |
| `autoplan.openTranscript` | `Auto-Plan: Open Active Transcript Log` | Mở file `transcript.jsonl` của phiên hiện tại trong editor |
| `autoplan.setPrompt` | `Auto-Plan: Set Prompt` | Thay đổi nhanh nội dung Prompt Text |

---

## 🛠️ Dành Cho Lập Trình Viên (Development & Testing)

### 1. Cài đặt môi trường
```bash
git clone https://github.com/skul9x/Auto-plan-Extension.git
cd Auto-plan-Extension
npm install
```

### 2. Biên dịch & Kiểm thử
```bash
# Biên dịch mã nguồn TypeScript
npm run compile

# Chế độ theo dõi thay đổi (Watch mode)
npm run watch

# Chạy trọn bộ unit & integration tests
npm test
```

### 3. Đóng gói VSIX
```bash
npm run package
```

---

## 📄 Bản Quyền & Tác Giả (License & Author)

- Tác giả: **skul9x**
- Dự án được phát hành theo giấy phép **MIT License**.
