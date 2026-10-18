# Phase 04: Telegram Remote Control Settings Card & End-to-End Rollback UI

Status: ✅ Completed
Completed At: 2026-10-14T06:27:00+07:00
Test: `src/test/phase04_telegram_settings_card_e2e.test.ts`

## Goals
1. **Build the Telegram Remote Control Card in `media/settings/settings.html`**:
   - Create a dedicated glassmorphism card within `#tab-telegram`:
     - **Master Bot Switch (`#chkTelegramEnabled`)**:
       - Bật/Tắt toàn bộ Telegram bridge.
       - Logic: Nếu user gạt ON mà `hasToken === false`:
         - Gửi `requestSetTelegramToken` tới backend để mở prompt nhập token.
         - Nếu nhận tin nhắn `tokenPromptCancelled` từ backend (do user bấm Esc hoặc Cancel): Tự động gạt switch ngược lại về OFF (Optimistic Rollback).
     - **Free-Text Chat Toggle (`#chkTelegramAllowFreeChat`)**:
       - Bật/Tắt nhận tin nhắn text tự do vào Antigravity IDE.
       - Tooltip / Description: *"When disabled, free-form text messages are silently dropped. Management and workflow slash commands (/plans, /plan_status, /code, /recap...) remain active."*
     - **Live Q&A Chat Mirroring Toggle (`#chkTelegramEnableChatMirror`)**:
       - Bật/Tắt mirror câu trả lời của AI và prompt PC về Telegram.
     - **Token Security Status Row**:
       - Status badge: `#telegramTokenBadge` (`🟢 Configured in SecretStorage` hoặc `🔴 Token Missing`).
       - Buttons: `#btnSetTelegramToken` (`🔑 Set Token...`) và `#btnClearTelegramToken` (`🗑️ Clear Token`).
     - **Allowed Users (Whitelist)**:
       - Input field `#txtTelegramAllowedUsers` (comma-separated user IDs or tag badges).
     - **Throttle Slider / Input**:
       - Slider `#rngTelegramThrottleMs` (range 500ms - 10000ms, default 2500ms).
2. **Style with VS Code Theme Tokens in `media/settings/settings.css`**:
   - Modern toggle sliders with glowing focus rings (`var(--vscode-focusBorder)`).
   - Clean status badges with pulse animations.
   - Accessible keyboard focus states for all switches and buttons.
3. **Verification**:
   - Exactly one test file: `src/test/phase04_telegram_settings_card_e2e.test.ts`.
   - Verify toggle bindings and state synchronization with `AutoPlanConfig`.
   - Verify that missing token triggers `requestSetTelegramToken` IPC.
   - Verify that `tokenPromptCancelled` executes optimistic rollback back to `false`.
   - Verify that token addition/clearing updates the UI badge status without exposing raw token string.

## Implementation Details

### 1. Telegram Card HTML Schema
```html
<section class="glass-card" id="sectionTelegramSettings">
  <div class="card-header">
    <div class="header-icon-title">
      <span class="section-icon">🤖</span>
      <div>
        <h2 class="card-title">Telegram Remote Control & Bot Bridge</h2>
        <p class="card-subtitle">Control IDE plans, receive notifications, and gate incoming AI chat from Telegram.</p>
      </div>
    </div>
  </div>

  <div class="toggles-list">
    <!-- Master Bot Switch -->
    <div class="switch-container">
      <label class="toggle-switch">
        <input type="checkbox" id="chkTelegramEnabled">
        <span class="toggle-slider"></span>
      </label>
      <div class="toggle-details">
        <span class="toggle-title">Enable Telegram Bot Bridge</span>
        <span class="toggle-description">Run background Telegram polling bridge for remote monitoring and command dispatch.</span>
      </div>
    </div>

    <!-- Free-Text Chat Gating -->
    <div class="switch-container">
      <label class="toggle-switch">
        <input type="checkbox" id="chkTelegramAllowFreeChat" checked>
        <span class="toggle-slider"></span>
      </label>
      <div class="toggle-details">
        <span class="toggle-title">Allow Free-Text Chat to IDE</span>
        <span class="toggle-description">When disabled, free-form text is silently dropped while slash commands (/plans, /code, /recap) remain active.</span>
      </div>
    </div>

    <!-- Live Q&A Mirroring -->
    <div class="switch-container">
      <label class="toggle-switch">
        <input type="checkbox" id="chkTelegramEnableChatMirror" checked>
        <span class="toggle-slider"></span>
      </label>
      <div class="toggle-details">
        <span class="toggle-title">Live Q&A Chat Mirroring</span>
        <span class="toggle-description">Mirror assistant responses and PC prompts back to authorized Telegram chats.</span>
      </div>
    </div>
  </div>

  <!-- Token Management Row -->
  <div class="token-mgmt-box">
    <div class="token-status-info">
      <span class="stat-label">Bot API Token:</span>
      <span id="telegramTokenBadge" class="status-badge badge-warning">🔴 Token Missing</span>
    </div>
    <div class="token-actions">
      <button type="button" id="btnSetTelegramToken" class="btn btn-secondary btn-sm">🔑 Set Token...</button>
      <button type="button" id="btnClearTelegramToken" class="btn btn-outline btn-danger-outline btn-sm">🗑️ Clear</button>
    </div>
  </div>
</section>
```

### 2. Rollback Logic in `media/settings/settings.js`
```javascript
chkTelegramEnabled.addEventListener('change', (e) => {
  if (e.target.checked && !currentTelegramStatus.hasToken) {
    // Optimistically request token from user
    vscode.postMessage({ command: 'requestSetTelegramToken' });
  } else {
    scheduleAutoSave();
  }
});

window.addEventListener('message', (event) => {
  const msg = event.data;
  if (msg.command === 'tokenPromptCancelled' && msg.rollback) {
    // Revert switch to OFF
    chkTelegramEnabled.checked = false;
    showToast('Telegram requires a valid bot token to enable.');
  }
});
```

## Verification
- Run: `node out/test/phase04_telegram_settings_card_e2e.test.js`.
- Ensure 100% of test assertions pass.
