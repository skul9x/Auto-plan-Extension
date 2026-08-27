# Ý tưởng dự án: Auto-Plan Extension (Antigravity Automation)

## 🎯 Mục tiêu
Tự động hóa luồng làm việc hàng loạt trong Antigravity IDE:
1. Gửi tổ hợp phím hoặc lệnh mở cuộc trò chuyện mới (`Ctrl + Shift + L`).
2. Nhập/paste đoạn văn bản cấu hình sẵn vào khung chat và gửi (Enter).
3. Giám sát hội thoại để bắt tín hiệu hoàn thành từ Agent (chuỗi `Done skul9x.`).
4. Lặp lại quá trình trên cho đủ 5 lần (hoặc theo cấu hình số lượt).

## 💡 Các hướng tiếp cận kỹ thuật khả thi (Sẽ phân tích ở /plan & /design)
- **Phương án 1 (VSCode/Antigravity Extension API)**: Tận dụng VSCode Extension API / Antigravity Internal Commands / Extension Host.
- **Phương án 2 (Desktop/UI Automation Sidecar Script)**: Node.js / Python automation (robotjs, nut.js, pyautogui, playwright-electron, hoặc direct accessibility/OS input).
- **Phương án 3 (Antigravity System Log/Transcript Watcher + Keyboard Simulation)**: Lắng nghe log JSONL (`.system_generated/logs/transcript.jsonl`) để biết chính xác khi nào Agent trả về `Done skul9x.` với độ tin cậy tuyệt đối 100%, kết hợp mô phỏng phím tắt.
