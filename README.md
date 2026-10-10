# AiUtility

AiUtility 是一個 Node.js 命令列工具，提供呼叫 OpenAI 相容 Chat Completion API 的功能，支援一次性提問、互動式聊天、模型清單及多組環境設定檔管理。

## 功能

- 呼叫 OpenAI 相容的 Chat Completion API
- 優先使用 SSE streaming，服務不支援時自動退回一般 JSON 回應
- 一次性提問與互動式聊天
- 查詢可用模型
- 管理多組 API 環境設定
- 保存及恢復互動式聊天 session

## 前置需求

- Node.js 18 或以上版本
- npm

確認版本：

```bash
node --version
npm --version
```

## 初始安裝

```bash
git clone <repository-url>
cd AiUtility
npm install
```

本專案使用內建的 `fetch`，因此建議使用 Node.js 18 以上版本。

## 安裝成全域指令

在專案根目錄執行：

```bash
npm install -g .
```

安裝完成後即可在任何目錄使用 `ai`：

```bash
ai help
ai env ls
ai openai ask "請簡單介紹你自己"
```

若要移除全域指令：

```bash
npm uninstall -g aiutility
```

全域安裝只會安裝 CLI 程式本身；環境設定仍放在執行指令時的目前專案目錄中。

## 建立環境設定

每一組環境設定都是根目錄中的 `<envfile>.env` 檔案，例如 `openai.env`。實際 `.env` 檔案包含敏感資訊，不應提交到 Git。

### 方式一：複製範例檔

```bash
cp example.env openai.env
```

接著編輯 `openai.env`，填入實際的 `API_KEY`、API 位址及模型名稱。

### 方式二：使用 CLI 建立

```bash
ai env add openai \
  API_KEY=your-api-key \
  AI_HOST=https://api.openai.com/v1 \
  DEFAULT_MODEL=gpt-4o-mini
```

支援的欄位如下：

| 欄位 | 說明 |
| --- | --- |
| `API_KEY` | API 金鑰；視服務需求設定 |
| `AI_HOST` | OpenAI 相容 API 的 base URL |
| `API_VERSION` | Azure OpenAI 等服務使用的 API 版本，可省略 |
| `DEFAULT_MODEL` | 未指定模型時使用的預設模型 |

檢查設定時，`env show` 會遮罩 `API_KEY`：

```bash
ai env show openai
```

## 基本指令

顯示完整說明：

```bash
ai help
```

列出環境設定檔：

```bash
ai env ls
```

列出指定服務的模型：

```bash
ai openai ls
```

發送一次性問題：

```bash
ai openai ask "請簡單介紹你自己"
```

指定模型發送一次性問題：

```bash
ai openai ask gpt-4o-mini "請摘要這段文字"
```

啟動互動式聊天：

```bash
ai openai chat
```

也可以在聊天時指定模型：

```bash
ai openai chat gpt-4o-mini
```

## 環境設定管理

```bash
# 顯示完整設定內容
ai env cat openai

# 修改既有設定
ai env set openai DEFAULT_MODEL=gpt-4.1-mini

# 顯示遮罩後的設定
ai env show openai

# 刪除設定檔；執行時會要求確認
ai env delete openai

# 腳本使用時跳過刪除確認
ai env delete openai --yes
```

## 互動式聊天指令

在 `chat` 模式中：

- `Enter`：送出訊息
- `Shift+Enter`：換行
- `/resume`：列出並恢復目前環境的 session
- `/new`：建立新的空白 session
- `/list`：列出目前環境的 session
- `/delete`：選取並刪除 session
- `/info`：顯示目前模型資訊
- `/model [model]`：查看或切換模型
- `/help` 或 `?`：顯示互動說明
- `/exit`：離開互動模式
- `Ctrl-D` 或 `Ctrl-C`：離開互動模式

聊天 session 會保存於使用者家目錄的 `~/.aiutility/sessions`，不會寫入本專案目錄。

## zsh 熱鍵：AI 指令助手（TUI）

在命令列忘記指令時，按 `Ctrl+G` 再按 `Ctrl+A`（或 `a`）開啟全螢幕 AI 對話；離開後畫面與輸入到一半的指令都會還原，可繼續工作。

設定：

```bash
# 1. 在 AiUtility 目錄建立 .env，指定預設的環境設定檔（例如 gssdev.env）
echo 'AI_DEFAULT_ENV=gssdev' > .env

# 2. 在 ~/.zshrc 加入（需先 npm install -g . 讓 ai 在 PATH 中）
source /path/to/AiUtility/ai.zsh
```

也可直接執行 `ai tui [envfile] [model]`；省略 `envfile` 時使用 `.env` 的 `AI_DEFAULT_ENV`，省略 `model` 時使用該環境的 `DEFAULT_MODEL`。

TUI 內的操作（最下一排會常駐顯示精簡說明，`/help` 顯示完整說明）：

- `Enter` 送出；`Shift+Enter`、`Alt+Enter` 或 `Ctrl+J` 換行
- 輸入框多行時，`↑` / `↓` 在行之間移動游標，方便回到上一行修改；捲動對話用 `PgUp` / `PgDn`（Mac：`Fn+↑` / `Fn+↓`）、`Ctrl+B` / `Ctrl+F`，或 `Shift+↑` / `Shift+↓`
- 多輪對話，預設每輪都帶前面的內容；`/context on|off` 開關（off 時只送當前訊息，歷史仍保留）
- 每輪有編號：`/copy [in|out|code] [n]` 複製第 n 輪（預設最後一輪）的輸入、輸出或第一個程式碼區塊；`Ctrl+Y` 複製最後一則 AI 回覆
- `/model [名稱]` 查看或切換模型、`/clear` 清空、`/exit`、`Esc`（輸入為空時）或 `Ctrl+D` 離開；回覆中 `Esc` / `Ctrl+C` 中斷
- 複製使用 `pbcopy`（macOS），其他環境依序嘗試 `wl-copy`、`xclip`、`xsel`，最後以 OSC 52 寫入終端剪貼簿
- 此模式不保存 session

注意：`^G` 原本是 zsh 的 `send-break`，作為前綴鍵後，單獨按 `Ctrl+G` 會等待 `KEYTIMEOUT`（預設 0.4 秒）。與 fzf-git.sh 共用 `Ctrl+G` 前綴，`a` 未被其佔用；想換鍵可修改 `ai.zsh` 最後兩行 `bindkey`。

## 安全注意事項

- 不要將任何 `<envfile>.env`、API 金鑰或其他秘密提交到 Git。
- `.gitignore` 已忽略所有 `*.env`，但若秘密檔案曾經被提交，仍需另外從 Git 歷史及服務端撤銷或輪替金鑰。
- 建議使用 `node ai.js env show <envfile>` 檢查設定，避免用 `env cat` 將完整金鑰輸出到共享畫面或日誌。
