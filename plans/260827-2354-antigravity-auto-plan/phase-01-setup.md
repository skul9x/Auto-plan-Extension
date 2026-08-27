# Phase 01: Setup Environment & Extension Scaffold
Status: ✅ Completed
Dependencies: None

## Objective
Khởi tạo cấu trúc dự án VS Code Extension chuẩn, cài đặt dependencies, cấu hình TypeScript compiler, VS Code Extension Manifest (`package.json`) và thiết lập các configuration keys.

## Requirements
### Functional
- [x] `package.json` định nghĩa extension `antigravity-auto-plan`, display name `Antigravity Auto-Plan Runner`.
- [x] Khai báo contribution points: commands (`autoplan.start`, `autoplan.stop`, `autoplan.setPrompt`), status bar items, configuration settings.
- [x] Cấu hình settings:
  - `autoplan.promptText`: Nội dung prompt (string, mặc định `"Hãy trả lời tôi với câu trả lời là \"Done skul9x.\", ngoài ra không nói gì thêm"`)
  - `autoplan.repeatCount`: Số lần lặp (number, mặc định `5`)
  - `autoplan.completionKeyword`: Từ khóa nhận diện hoàn thành (string, mặc định `"Done skul9x."`)
  - `autoplan.delayBetweenLoopsMs`: Thời gian chờ giữa các lần lặp (number, mặc định `2000`)
- [x] Cấu hình `tsconfig.json` và script build `compile`, `watch`, `package`.

## Files to Create/Modify
- `package.json` - Extension manifest và metadata
- `tsconfig.json` - TypeScript config
- `.vscodeignore` - Danh sách exclude khi build vsix
- `src/config.ts` - Helper đọc/ghi extension configuration

## Test Criteria
- [x] `npm run compile` chạy thành công không có lỗi lint hoặc type error.

