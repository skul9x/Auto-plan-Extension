# Antigravity Auto-Plan Extension

<p align="center">
  <img src="https://raw.githubusercontent.com/skul9x/Auto-plan-Extension/main/docs/assets/banner.png" alt="Antigravity Auto-Plan Extension Banner" width="100%" onerror="this.style.display='none'"/>
</p>

<p align="center">
  <a href="https://github.com/skul9x/Auto-plan-Extension/releases"><img src="https://img.shields.io/badge/ph%C3%AAn_b%E1%BA%A3n-1.1.0-blue.svg?style=flat-square" alt="Phiên bản"></a>
  <a href="https://code.visualstudio.com/"><img src="https://img.shields.io/badge/T%C6%B0%C6%A1ng_th%C3%ADch-VS_Code_^1.80.0-informational.svg?style=flat-square" alt="Độ tương thích VS Code"></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-5.3.3-3178C6.svg?style=flat-square" alt="TypeScript"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/gi%E1%BA%A5y_ph%C3%A9p-MIT-green.svg?style=flat-square" alt="Giấy phép"></a>
  <img src="https://img.shields.io/badge/n%E1%BB%81n_t%E1%BA%A3ng-Linux_%7C_macOS_%7C_Windows-lightgrey.svg?style=flat-square" alt="Hỗ trợ nền tảng">
</p>

---

## 📖 Tổng quan

**Antigravity Auto-Plan Extension** (`antigravity-auto-plan`) là công cụ tự động hóa và điều phối kế hoạch phát triển phần mềm nâng cao dành cho **Antigravity IDE** và **Visual Studio Code**. 

Extension cho phép tự động hóa việc thực thi các kế hoạch phát triển nhiều giai đoạn (multi-phase plans với các file `phase-01-*.md`, `phase-02-*.md`,...), stream trực tiếp nhật ký hội thoại AI (transcript) theo thời gian thực và tự động chuyển sang phase tiếp theo ngay khi nhận được tín hiệu hoàn thành (`"Done skul9x."`).

---

## ✨ Các tính năng nổi bật

### 🖼️ Trung tâm điều khiển Sidebar (Sidebar Control Center)
- Giao diện trực quan tích hợp sẵn tại Activity Bar (`autoplan-sidebar-container`) mang tên **Plan Execution Dashboard**.
- Hỗ trợ tự động phát hiện danh sách thư mục chứa plan, chọn plan đang hoạt động, xem danh sách phase với khả năng bật/tắt từng phase linh hoạt và stream log transcript trực tiếp.
- Hiển thị trạng thái theo thời gian thực (Đang chạy, Tạm dừng, Lỗi, Hoàn thành) kèm bộ đếm tiến độ và các nút thao tác nhanh.

### ⚡ DOM Bridge không cần Focus (Focus-Free DOM Bridge)
- Truyền lệnh prompt ngầm qua cơ chế IPC trực tiếp vào ngữ cảnh Electron Renderer HTML (`workbench.html`) của VS Code / Antigravity Workbench.
- Tự động điền nội dung prompt và kích hoạt nút gửi chat trực tiếp trên cây DOM, giúp bạn **vừa lướt web vừa để extension tự chạy** mà không sợ bị cướp tiêu điểm (focus) bàn phím/chuột.
- Tích hợp HTTP server tự động dò cổng (`127.0.0.1:49200-49220`) để giao tiếp IPC đáng tin cậy giữa Extension Host và script DOM đã chèn.

### 🎯 Cơ chế vận chuyển 3 tầng linh hoạt (3-Tier Resilient Transport)
- **Tier 1 (DOM Bridge):** Tốc độ cao, chạy ngầm không cần focus, không ảnh hưởng đến trải nghiệm thao tác của người dùng.
- **Tier 2 (VS Code Native Commands):** Tự động chuyển đổi sang các lệnh nội bộ của VS Code khi môi trường hỗ trợ.
- **Tier 3 (OS Keyboard Simulation):** Sử dụng công cụ tự động hóa phím bấm ở cấp hệ điều hành (`xdotool` trên Linux, PowerShell `WScript.Shell` trên Windows) làm giải pháp dự phòng cuối cùng.

### ⚡ Kiểm tra sẵn sàng tức thì (Zero-Timeout Pre-Flight Guard)
- Kiểm tra sức khỏe môi trường thực thi và trạng thái transport trong chưa đầy **100ms** trước khi bắt đầu plan.
- Ngăn chặn vòng lặp thực thi vô tận bằng cách xác minh tính khả dụng của transport trước khi chạy từng giai đoạn.
- Đưa ra thông báo chẩn đoán lỗi rõ ràng cùng các hành động khắc phục 1-click (như gợi ý chạy 1-Click Bridge Setup).

### 🔍 Bộ theo dõi Transcript chống nhiễu (Anti-Pollution Transcript Watcher)
- Đọc và phân tích file nhật ký JSONL thời gian thực tại thư mục `~/.gemini/antigravity-ide/brain/`.
- Đọc tăng tiến theo byte offset và có cơ chế bảo vệ dựa trên mtime thư mục gốc.
- Bộ lọc chống nhiễu phát hiện khoảng lặng (quiet-period debounce) giúp tránh nhận diện nhầm các tin nhắn trung gian của người dùng hoặc các cập nhật log thông thường.

---

## 📥 Hướng dẫn cài đặt & Thiết lập

### Thiết lập DOM Bridge 1-Click (Khuyến nghị)
Mở Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) và chạy lệnh:
`Auto-Plan: 1-Click DOM Bridge Setup` (`autoplan.oneClickSetup`)

Lệnh này sẽ tự động kiểm tra môi trường, chèn script DOM bridge vào file `workbench.html` và xác minh kết nối heartbeat giữa client và server.

### Quyền quản trị trên Linux (Polkit `pkexec`)
Trên các hệ điều hành Linux, việc ghi vào file `workbench.html` nằm trong các thư mục hệ thống (như `/usr/share/code/` hoặc `/opt/Antigravity/`) yêu cầu quyền quản trị viên:
- Auto-Plan sử dụng cơ chế Polkit (`pkexec`) để yêu cầu xác thực root một cách an toàn.
- Sau khi chạy lệnh setup, hãy nhập mật khẩu người dùng khi cửa sổ Polkit xuất hiện.
- Nếu không cấp quyền hoặc bị hủy, Auto-Plan sẽ tự động chuyển sang chế độ không cần quyền quản trị hoặc giả lập phím bấm.

### Cài đặt `xdotool` dự phòng trên Linux
Nếu không sử dụng chế độ DOM Bridge trên Linux, cơ chế Tier 3 (Giả lập phím bấm OS) sẽ cần `xdotool`:
```bash
# Ubuntu / Debian
sudo apt-get install xdotool

# Arch Linux
sudo pacman -S xdotool

# Fedora
sudo dnf install xdotool
```

### Cài đặt Extension VSIX
```bash
# Cài đặt vào Antigravity IDE
antigravity --install-extension antigravity-auto-plan-1.1.0.vsix

# Cài đặt vào VS Code
code --install-extension antigravity-auto-plan-1.1.0.vsix
```

---

## 🎮 Hướng dẫn giao diện người dùng

### Nút Status Bar thông minh (`🚀 Auto-Plan`)
- Hiển thị tiến độ theo thời gian thực: `$(sync~spin) Auto-Plan: [2/5] phase-02-readme.md`
- Di chuột qua nút Status Bar để xem tooltip định dạng Markdown chi tiết: thư mục hiện tại, tiến độ các phase, thời gian đã chạy và chế độ transport đang dùng.
- Bấm vào nút Status Bar để mở **Action Menu tác vụ**:
  - 🛑 **Stop Auto-Plan**: Dừng ngay lập tức quá trình tự động hóa.
  - ⏭️ **Skip Current Phase**: Bỏ qua phase đang chạy và chuyển sang phase tiếp theo.
  - 📄 **Open Active Transcript Log**: Mở trực tiếp file `transcript.jsonl` đang hoạt động trong trình biên soạn.

### Control Dashboard ở Sidebar
- Truy cập từ biểu tượng Auto-Plan tại Activity Bar.
- Xem toàn bộ cây phase plan, bật/tắt từng phase độc lập, bắt đầu/dừng tự động hóa và theo dõi log live stream mà không cần rời khỏi giao diện IDE.

---

## ⚙️ Cấu hình (Settings)

Extension có thể được tùy chỉnh thông qua VS Code Settings (`Ctrl+,` hoặc `Cmd+,`). Tất cả cài đặt nằm dưới tiền tố `autoplan`:

| Tên cài đặt | Kiểu dữ liệu | Giá trị mặc định | Mô tả |
|---|---|---|---|
| `autoplan.defaultPromptTemplate` | `string` | *(Mẫu chuẩn)* | Mẫu prompt mặc định cho từng phase (hỗ trợ `{xxx}`, `{path}`, hoặc `{file}`). |
| `autoplan.promptTemplate` | `string` | *(Mẫu chuẩn)* | Mẫu prompt động cho từng file phase riêng biệt. |
| `autoplan.promptText` | `string` | `"Hãy trả lời tôi..."` | Nội dung prompt tĩnh tự động dán vào ô chat. |
| `autoplan.defaultPlanFolder` | `string` | `""` | Đường dẫn thư mục mặc định chứa các file Markdown plan phase. |
| `autoplan.repeatCount` | `number` | `5` | Số lần lặp lại cho việc gửi prompt tĩnh. |
| `autoplan.completionKeyword` | `string` | `"Done skul9x."` | Từ khóa trong câu trả lời của AI đánh dấu phase đã hoàn thành. |
| `autoplan.delayBetweenLoopsMs` | `number` | `2000` | Thời gian chờ (mili-giây) giữa các vòng lặp phase plan. |
| `autoplan.timeoutPerLoopMinutes` | `number` | `15` | Thời gian chờ tối đa (phút) cho mỗi phase. |
| `autoplan.focusDelayMs` | `number` | `800` | Thời gian chờ (mili-giây) sau khi mở chat trước khi focus vào ô nhập. |
| `autoplan.executionMode` | `string` | `"auto"` | Chế độ transport gửi prompt (`auto`, `domBridge`, `nativeCommand`, `keyboard`). |
| `autoplan.bridgeTimeoutMs` | `number` | `5000` | Thời gian chờ tối đa (mili-giây) phản hồi từ DOM Bridge. |
| `autoplan.autoApprovePermissions` | `boolean` | `true` | Tự động phê duyệt các quyền thực thi thông qua DOM bridge. |
| `autoplan.autoInjectWorkbench` | `boolean` | `true` | Tự động đảm bảo workbench được chèn script DOM bridge khi khởi động. |

---

## 🛠️ Danh sách Lệnh (Command Reference)

| Command ID | Tên lệnh | Mô tả |
|---|---|---|
| `autoplan.start` | `Auto-Plan: Start Automation` | Mở danh sách chọn plan và bắt đầu tự động chạy các phase. |
| `autoplan.stop` | `Auto-Plan: Stop Automation` | Dừng ngay lập tức tiến trình tự động hóa. |
| `autoplan.skipPhase` | `Auto-Plan: Skip Current Phase` | Bỏ qua phase hiện tại và chuyển sang phase tiếp theo trong hàng chờ. |
| `autoplan.actionMenu` | `Auto-Plan: Show Running Action Menu` | Hiển thị menu tác vụ (Dừng, Bỏ qua, Xem Transcript). |
| `autoplan.openTranscript` | `Auto-Plan: Open Active Transcript Log` | Mở file transcript `transcript.jsonl` đang active trong trình biên soạn. |
| `autoplan.setPrompt` | `Auto-Plan: Set Prompt` | Thay đổi nội dung prompt đang hoạt động một cách linh hoạt. |
| `autoplan.installBridge` | `Auto-Plan: Install / Update DOM Automation Bridge` | Chèn script tự động hóa DOM vào file `workbench.html`. |
| `autoplan.uninstallBridge` | `Auto-Plan: Uninstall DOM Automation Bridge` | Gỡ bỏ script tự động hóa DOM khỏi file `workbench.html`. |
| `autoplan.checkBridgeStatus` | `Auto-Plan: Check Bridge Status & Run Diagnostic` | Kiểm tra sức khỏe HTTP server và client của DOM bridge. |
| `autoplan.openSidebar` | `Auto-Plan: Open Auto-Plan Control Center` | Mở giao diện điều khiển Sidebar trên Activity Bar. |
| `autoplan.oneClickSetup` | `Auto-Plan: 1-Click DOM Bridge Setup` | Tự động cài đặt và kiểm tra kết nối DOM bridge chỉ với 1 click. |
| `autoplan.checkStatus` | `Auto-Plan: Check Status & Diagnostics` | Thao tác kiểm tra toàn diện sức khỏe hệ thống và transport pre-flight. |

---

## 🐛 Xử lý sự cố (Troubleshooting)

### "Linux Pre-Flight Failed"
**Nguyên nhân:** DOM Bridge bị mất kết nối và công cụ `xdotool` chưa được cài đặt trên Linux.  
**Cách xử lý:**
1. Chạy lệnh `Auto-Plan: 1-Click DOM Bridge Setup` (`autoplan.oneClickSetup`) để kích hoạt chế độ DOM Bridge không cần focus.
2. Hoặc cài đặt `xdotool` thủ công bằng trình quản lý gói của hệ điều hành (`sudo apt-get install xdotool`).

### Sửa lỗi popup reload liên tục do thay đổi Workbench
**Nguyên nhân:** Sau khi sửa đổi file cấu trúc `workbench.html` của VS Code / Antigravity IDE, cơ chế kiểm tra tính toàn vẹn của Electron có thể phát cảnh báo.  
**Cách xử lý:** Chạy lệnh `Developer: Reload Window` (`Ctrl+R` / `Cmd+R`) trong VS Code sau khi hoàn tất thiết lập 1-Click setup.

### CSP & Lỗi dò cổng Localhost
**Nguyên nhân:** Chính sách bảo mật Content Security Policy (CSP) chặn kết nối HTTP localhost giữa Extension Host và Renderer.  
**Cách xử lý:** Auto-Plan tự động cập nhật thẻ meta CSP cho phép kết nối tới `http://127.0.0.1:49200-49220`. Nếu vẫn gặp lỗi kết nối, hãy kiểm tra lại cấu hình tường lửa (firewall) hoặc phần mềm diệt virus cá nhân.

---

## 💻 Hướng dẫn phát triển (Development)

### Cấu trúc thư mục dự án
```text
Auto-plan-Extension/
├── media/                     # Giao diện Webview Sidebar & script DOM Bridge
│   ├── bridge/                # Script DOM bridge chèn vào Workbench
│   └── sidebar/               # HTML/CSS/JS cho dashboard điều khiển Sidebar
├── src/                       # Mã nguồn TypeScript của Extension
│   ├── bridgeServer.ts        # HTTP IPC Server nội bộ cho DOM Bridge
│   ├── keyboardManager.ts     # Mô phỏng phím bấm cấp hệ điều hành Tier 3
│   ├── orchestrator.ts        # Bộ điều phối tự động chạy các phase plan
│   ├── promptDispatcher.ts    # Bộ vận chuyển prompt 3 tầng linh hoạt
│   ├── sidebarViewProvider.ts # Provider cung cấp webview trên Activity Bar
│   ├── transcriptWatcher.ts   # Bộ theo dõi log JSONL chống nhiễu
│   └── test/                  # Thư mục chứa các bộ test kiểm thử
├── package.json               # Manifest extension & định nghĩa cấu hình
├── tsconfig.json              # Cấu hình biên dịch TypeScript
└── README.md                  # Tài liệu hướng dẫn sử dụng tiếng Việt
```

### Biệt dịch & Đóng gói VSIX
```bash
# Clone repository
git clone https://github.com/skul9x/Auto-plan-Extension.git
cd Auto-plan-Extension

# Cài đặt dependencies
npm install

# Biên dịch TypeScript
npm run compile

# Đóng gói file cài đặt VSIX
npm run package
```

### Chạy các bộ kiểm thử (Test Suites)
```bash
# Chạy bộ test Phase 01: Elevation & Keyboard
npm run test:phase01

# Chạy bộ test Phase 02: Fail-Fast Pre-Flight & Documentation
npm run test:phase02

# Chạy bộ test Phase 03: Sidebar Webview
npm run test:phase03

# Chạy bộ test Phase 04: Actionable Notifications
npm run test:phase04

# Chạy bộ test Phase 05: E2E Cross-Platform Release
npm run test:phase05

# Chạy riêng lẻ test Documentation Phase 02
npx tsc && node out/test/phase02_readme_documentation.test.js
```

---

## 📜 Giấy phép (License)

Dự án được phân phối theo **MIT License**. Xem file `LICENSE` để biết thêm chi tiết.
