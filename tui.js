/**
 * tui.js
 * 全螢幕（alternate screen）的 AI 指令助手對話介面。
 * 不依賴 ai.js（ai.js 載入即執行 main），所有相依物件由 runTui 參數傳入。
 */
const fs = require('fs');
const { spawn } = require('child_process');
const { StringDecoder } = require('string_decoder');

const ESC = '\x1b';
const PASTE_START = `${ESC}[200~`;
const PASTE_END = `${ESC}[201~`;
const RESET = `${ESC}[0m`;
const STYLE = {
    header: `${ESC}[48;5;24m${ESC}[1m${ESC}[37m`,
    footer: `${ESC}[48;5;238m${ESC}[37m`,
    user: `${ESC}[48;5;236m${ESC}[37m`,
    ai: `${ESC}[48;5;17m${ESC}[37m`,
    code: `${ESC}[33m`,
    codeEnd: `${ESC}[37m`,
    dim: `${ESC}[2m`,
    error: `${ESC}[31m`,
    status: `${ESC}[36m`,
};
const SYSTEM_PROMPT = '你是 macOS zsh 終端機裡的指令助手。用正體中文台灣用語回答，簡短扼要；'
    + '先給可直接執行的指令（每個用途一個 ``` 程式碼區塊），再用一兩句說明重要參數；會刪除資料或改寫歷史的指令要特別提醒。';
const FOOTER = '/context on|off 帶上下文  /copy [in|out|code] [n]  /model  /clear  /help  /exit  │ Ctrl+Y 複製 Esc 離開';
const HELP = `互動說明：
  Enter 送出；Shift+Enter、Alt+Enter 或 Ctrl+J 換行；貼上多行會保留在同一則訊息
  ↑ / ↓                    多行輸入時上下移動游標（單行或在邊緣時捲動對話）
  PgUp / PgDn（Mac：Fn+↑/↓）或 Ctrl+B / Ctrl+F  捲動一頁
  Shift+↑ / Shift+↓        捲動一列
  Ctrl+A / Ctrl+E / Ctrl+U 行首 / 行尾 / 清空輸入
  Ctrl+Y                   複製最後一則 AI 回覆
  Esc                      回覆中：中斷；輸入中：清空；空白時：離開
  Ctrl+C                   回覆中：中斷；閒置時：離開
  Ctrl+D                   輸入為空時離開

指令：
  /context [on|off]        每輪是否帶前面的對話（預設 on；off 時只送當前訊息，歷史仍保留）
  /copy [in|out|code] [n]  複製第 n 輪（預設最後一輪）的輸入 / 輸出 / 第一個程式碼區塊；預設為 out
  /model [名稱]            列出可用模型，或切換模型
  /clear                   清空所有輪次
  /help                    顯示這份說明
  /exit                    離開，回到原本的畫面`;

function charWidth(cp) {
    if (cp < 32 || (cp >= 0x7f && cp < 0xa0)) return 0;
    if (cp >= 0x300 && cp <= 0x36f) return 0;
    if ((cp >= 0x1100 && cp <= 0x115f) || (cp >= 0x2e80 && cp <= 0xa4cf) || (cp >= 0xac00 && cp <= 0xd7a3)
        || (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xfe30 && cp <= 0xfe6f) || (cp >= 0xff00 && cp <= 0xff60)
        || (cp >= 0xffe0 && cp <= 0xffe6) || (cp >= 0x1f300 && cp <= 0x1f64f) || (cp >= 0x1f900 && cp <= 0x1f9ff)
        || (cp >= 0x20000 && cp <= 0x3fffd)) return 2;
    return 1;
}
function textWidth(text) { let width = 0; for (const ch of text) width += charWidth(ch.codePointAt(0)); return width; }
function padRight(text, width) { return text + ' '.repeat(Math.max(0, width - textWidth(text))); }
function truncate(text, width) {
    let out = '';
    let used = 0;
    for (const ch of text) {
        const w = charWidth(ch.codePointAt(0));
        if (used + w > width) break;
        out += ch;
        used += w;
    }
    return out;
}

/**
 * 依顯示寬度換行。text 以 \n 分段；回傳每列的 [start, end) 字元索引（以 code point 計）。
 */
function layout(chars, width) {
    const rows = [];
    let start = 0;
    let used = 0;
    for (let i = 0; i < chars.length; i++) {
        if (chars[i] === '\n') { rows.push({ start, end: i }); start = i + 1; used = 0; continue; }
        const w = charWidth(chars[i].codePointAt(0));
        if (used + w > width) { rows.push({ start, end: i }); start = i; used = 0; }
        used += w;
    }
    rows.push({ start, end: chars.length });
    return rows;
}
function wrapText(text, width) {
    const chars = [...text.replace(/\t/g, '    ').replace(/\r/g, '')];
    return layout(chars, width).map(row => chars.slice(row.start, row.end).join(''));
}

function copyToClipboard(text) {
    return new Promise(resolve => {
        const candidates = process.platform === 'darwin'
            ? [['pbcopy']]
            : [['wl-copy'], ['xclip', '-selection', 'clipboard'], ['xsel', '-ib']];
        const tryNext = index => {
            if (index >= candidates.length) {
                process.stdout.write(`${ESC}]52;c;${Buffer.from(text).toString('base64')}\x07`);
                resolve('OSC 52');
                return;
            }
            const [command, ...commandArgs] = candidates[index];
            let settled = false;
            const next = () => { if (!settled) { settled = true; tryNext(index + 1); } };
            try {
                const child = spawn(command, commandArgs, { stdio: ['pipe', 'ignore', 'ignore'] });
                child.once('error', next);
                child.once('close', code => {
                    if (settled) return;
                    if (code === 0) { settled = true; resolve(command); } else next();
                });
                child.stdin.on('error', () => {});
                child.stdin.end(text);
            } catch { next(); }
        };
        tryNext(0);
    });
}

function firstCodeBlock(text) {
    const closed = text.match(/```[^\n]*\n([\s\S]*?)```/);
    const open = closed || text.match(/```[^\n]*\n([\s\S]*)$/);
    return open ? open[1].replace(/\n+$/, '') : null;
}

function runTui({ ai, envfile, model }) {
    const stdin = process.stdin;
    const stdout = process.stdout;
    if (!stdin.isTTY || !stdout.isTTY || typeof stdin.setRawMode !== 'function') {
        return Promise.reject(new Error('tui 需要在互動式終端機中執行。'));
    }

    const entries = [{ kind: 'note', text: `環境 ${envfile}，模型 ${model}。直接輸入問題；/help 查看說明，/exit 離開。` }];
    let turnCount = 0;
    let contextOn = true;
    let input = [];
    let cursor = 0;
    let scroll = 0;
    let status = '';
    let statusTimer = null;
    let renderTimer = null;
    let escTimer = null;
    let controller = null;
    let busy = false;
    let closed = false;
    let buffer = '';
    const decoder = new StringDecoder('utf8');
    const originalConsoleError = console.error;
    // aiutility.listModels 失敗時會 console.error，會破壞全螢幕畫面。
    console.error = () => {};

    let resolveFinished;
    const finished = new Promise(resolve => { resolveFinished = resolve; });
    function restoreTerminal() {
        try { fs.writeSync(stdout.fd, `${ESC}[?2004l${ESC}[?7h${ESC}[?25h${ESC}[?1049l`); } catch { /* 終端機已關閉 */ }
    }
    function finish() {
        if (closed) return;
        closed = true;
        clearTimeout(renderTimer);
        clearTimeout(statusTimer);
        clearTimeout(escTimer);
        controller?.abort();
        stdin.removeListener('data', onData);
        stdout.removeListener('resize', render);
        process.removeListener('exit', restoreTerminal);
        stdin.setRawMode(false);
        stdin.pause();
        restoreTerminal();
        console.error = originalConsoleError;
        resolveFinished();
    }

    const turns = () => entries.filter(entry => entry.kind === 'turn');
    const completedTurns = () => turns().filter(turn => !turn.pending && !turn.error && turn.output);
    const note = text => { entries.push({ kind: 'note', text }); scroll = 0; };
    const setStatus = text => {
        status = text;
        clearTimeout(statusTimer);
        statusTimer = setTimeout(() => { status = ''; render(); }, 4000);
    };

    function conversationLines(cols) {
        const width = Math.max(10, cols - 2);
        const styled = (style, text) => `${style}${padRight(`  ${text}`, cols)}${RESET}`;
        const lines = [];
        for (const entry of entries) {
            if (entry.kind === 'note') {
                wrapText(entry.text, width).forEach(line => lines.push(`${STYLE.dim}  ${line}${RESET}`));
                lines.push('');
                continue;
            }
            lines.push(styled(`${STYLE.user}${ESC}[1m`, `#${entry.n} 你`));
            wrapText(entry.input, width).forEach(line => lines.push(styled(STYLE.user, line)));
            lines.push(styled(`${STYLE.ai}${ESC}[1m`, `#${entry.n} AI${entry.pending ? '（回覆中，Esc 中斷）' : ''}`));
            if (!entry.output && entry.pending) lines.push(styled(STYLE.ai, '⏳ ...'));
            let inCode = false;
            for (const raw of entry.output.split('\n')) {
                const isFence = raw.trimStart().startsWith('```');
                if (isFence) inCode = !inCode;
                const style = isFence || inCode ? `${STYLE.ai}${STYLE.code}` : STYLE.ai;
                wrapText(raw, width).forEach(line => lines.push(styled(style, line)));
            }
            if (entry.error) wrapText(entry.error, width).forEach(line => lines.push(`${STYLE.error}  ${line}${RESET}`));
            lines.push('');
        }
        return lines;
    }

    const inputLayout = () => layout(input, (stdout.columns || 80) - 2);
    const rowIndexOf = (rows, index) => rows.reduce((found, row, i) => (row.start <= index ? i : found), 0);

    function moveCursorVertically(delta) {
        const rows = inputLayout();
        const current = rowIndexOf(rows, cursor);
        const target = rows[current + delta];
        if (!target) return false;
        const column = textWidth(input.slice(rows[current].start, cursor).join(''));
        let position = target.start;
        let used = 0;
        while (position < target.end) {
            const width = charWidth(input[position].codePointAt(0));
            if (used + width > column) break;
            used += width;
            position++;
        }
        cursor = position;
        return true;
    }

    function render() {
        if (closed) return;
        const cols = stdout.columns || 80;
        const rows = stdout.rows || 24;
        let out = `${ESC}[?25l`;
        if (rows < 8 || cols < 30) {
            out += `${ESC}[2J${ESC}[H視窗太小，請放大終端機。`;
            stdout.write(out);
            return;
        }
        const chars = input;
        const inputRows = inputLayout();
        const cursorRow = rowIndexOf(inputRows, cursor);
        const inputHeight = Math.min(5, inputRows.length);
        const inputStart = Math.max(0, Math.min(cursorRow - inputHeight + 1, inputRows.length - inputHeight));
        const convHeight = rows - 3 - inputHeight;
        const lines = conversationLines(cols);
        const maxScroll = Math.max(0, lines.length - convHeight);
        scroll = Math.min(Math.max(scroll, 0), maxScroll);
        const first = Math.max(0, lines.length - convHeight - scroll);
        const visible = lines.slice(first, first + convHeight);
        while (visible.length < convHeight) visible.push('');

        const done = completedTurns().length;
        const header = ` AI 指令助手  env:${envfile}  model:${model}  context:${contextOn ? `ON（帶 ${done} 輪）` : 'OFF（只送當前訊息）'}`;
        const frame = [`${STYLE.header}${padRight(truncate(header, cols), cols)}${RESET}`, ...visible];
        const hint = scroll > 0 ? `↑ 已捲動 ${scroll} 列（PgDn 回到最新）` : '';
        const statusText = [status, hint].filter(Boolean).join('  ');
        frame.push(`${STYLE.dim}${'─'.repeat(Math.max(0, cols - textWidth(statusText) - 2))}${RESET}${STYLE.status}${statusText ? ` ${statusText} ` : '──'}${RESET}`);
        for (let i = inputStart; i < inputStart + inputHeight; i++) {
            const row = inputRows[i];
            frame.push(`${i === 0 ? '› ' : '  '}${chars.slice(row.start, row.end).join('')}`);
        }
        frame.push(`${STYLE.footer}${padRight(truncate(` ${FOOTER}`, cols), cols)}${RESET}`);

        frame.slice(0, rows).forEach((line, index) => { out += `${ESC}[${index + 1};1H${line}${RESET}${ESC}[K`; });
        const row = inputRows[cursorRow];
        const cursorCol = 2 + textWidth(chars.slice(row.start, cursor).join(''));
        out += `${ESC}[${convHeight + 3 + (cursorRow - inputStart)};${Math.min(cursorCol, cols - 1) + 1}H${ESC}[?25h`;
        stdout.write(out);
    }
    const scheduleRender = () => {
        if (renderTimer) return;
        renderTimer = setTimeout(() => { renderTimer = null; render(); }, 30);
    };

    function buildMessages(text) {
        const history = contextOn
            ? completedTurns().flatMap(turn => [{ role: 'user', content: turn.input }, { role: 'assistant', content: turn.output }])
            : [];
        return [{ role: 'system', content: SYSTEM_PROMPT }, ...history, { role: 'user', content: text }];
    }

    async function sendMessage(text) {
        const messages = buildMessages(text);
        const turn = { kind: 'turn', n: ++turnCount, input: text, output: '', pending: true, error: '' };
        entries.push(turn);
        scroll = 0;
        busy = true;
        controller = new AbortController();
        render();
        try {
            const response = await ai.callChatCompletionStream(model, messages, delta => {
                turn.output += delta;
                scheduleRender();
            }, 0.7, 8192, controller.signal);
            turn.output = response.choices?.[0]?.message?.content || turn.output;
            if (!turn.output) turn.error = 'AI 沒有回覆內容。';
        } catch (error) {
            turn.error = controller.signal.aborted ? '已中斷 AI 回覆。' : `API 呼叫失敗：${error.message}`;
        }
        turn.pending = false;
        busy = false;
        controller = null;
        render();
    }

    async function copyTurn(args) {
        let kind = 'out';
        let number = null;
        for (const arg of args) {
            if (['in', 'out', 'code'].includes(arg)) kind = arg;
            else if (/^\d+$/.test(arg)) number = Number(arg);
            else { note(`/copy 參數無效：${arg}。用法：/copy [in|out|code] [n]`); return; }
        }
        const all = turns().filter(turn => kind === 'in' || turn.output);
        const turn = number === null ? all[all.length - 1] : all.find(item => item.n === number);
        if (!turn) { setStatus(number === null ? '還沒有可複製的內容' : `找不到第 ${number} 輪`); return; }
        const text = kind === 'in' ? turn.input : kind === 'code' ? firstCodeBlock(turn.output) : turn.output;
        if (!text) { setStatus(`#${turn.n} 沒有程式碼區塊`); return; }
        const via = await copyToClipboard(text);
        setStatus(`已複製 #${turn.n} ${{ in: '輸入', out: '輸出', code: '程式碼' }[kind]}（${via}）`);
    }

    async function switchModel(name) {
        if (!name) {
            try {
                const models = await ai.listModels();
                const list = (models.data || []).map(item => `${item.id === model ? '* ' : '  '}${item.id}`).join('\n');
                note(`目前模型：${model}\n${list || 'API 沒有回傳可用模型。'}`);
            } catch (error) { note(`目前模型：${model}\n無法取得模型清單：${error.message}`); }
            return;
        }
        try {
            const models = await ai.listModels();
            if (!(models.data || []).some(item => item.id === name)) { note(`找不到模型：${name}，仍使用 ${model}`); return; }
        } catch (error) { note(`無法驗證模型 ${name}：${error.message}，仍使用 ${model}`); return; }
        model = name;
        setStatus(`已切換模型：${model}`);
    }

    async function runCommand(text) {
        const [command, ...args] = text.trim().split(/\s+/);
        if (command === '/exit' || command === '/quit') { finish(); return; }
        if (command === '/help') note(HELP);
        else if (command === '/clear') { entries.length = 0; turnCount = 0; note('已清空所有輪次。'); }
        else if (command === '/context') {
            const value = (args[0] || '').toLowerCase();
            if (value && !['on', 'off'].includes(value)) note('用法：/context [on|off]');
            else {
                contextOn = value ? value === 'on' : !contextOn;
                setStatus(contextOn ? 'context ON：每輪帶前面的對話' : 'context OFF：每輪只送當前訊息');
            }
        } else if (command === '/copy') await copyTurn(args);
        else if (command === '/model') await switchModel(args[0]);
        else note(`未知的指令：${command}。輸入 /help 查看說明。`);
        render();
    }

    function submit() {
        const text = input.join('');
        if (!text.trim()) return;
        input = [];
        cursor = 0;
        if (text.trim().startsWith('/')) runCommand(text); else sendMessage(text);
        render();
    }

    function insert(text) {
        const chars = [...text.replace(/\r\n?/g, '\n')];
        input.splice(cursor, 0, ...chars);
        cursor += chars.length;
    }

    function abortOrExit() {
        if (busy) controller?.abort(); else finish();
    }

    function onKey(key) {
        if (key === 'ctrlc') { abortOrExit(); return; }
        if (key === 'esc') {
            if (busy) controller?.abort();
            else if (input.length) { input = []; cursor = 0; }
            else finish();
            return;
        }
        const page = Math.max(1, (stdout.rows || 24) - 6);
        if (key === 'pgup') scroll += page;
        else if (key === 'pgdn') scroll -= page;
        else if (key === 'sup') scroll += 1;
        else if (key === 'sdown') scroll -= 1;
        else if (key === 'up' || key === 'down') { if (busy || !moveCursorVertically(key === 'up' ? -1 : 1)) scroll += key === 'up' ? 1 : -1; }
        else if (key === 'ctrly') copyTurn([]).then(render);
        else if (key === 'ctrll') { /* 只重繪 */ }
        else if (busy) { /* 回覆中不接受輸入 */ }
        else if (key === 'enter') { submit(); return; }
        else if (key === 'newline') insert('\n');
        else if (key === 'ctrld') { if (!input.length) finish(); else if (cursor < input.length) input.splice(cursor, 1); }
        else if (key === 'left') cursor = Math.max(0, cursor - 1);
        else if (key === 'right') cursor = Math.min(input.length, cursor + 1);
        else if (key === 'home') { while (cursor > 0 && input[cursor - 1] !== '\n') cursor--; }
        else if (key === 'end') { while (cursor < input.length && input[cursor] !== '\n') cursor++; }
        else if (key === 'backspace') { if (cursor > 0) input.splice(--cursor, 1); }
        else if (key === 'delete') { if (cursor < input.length) input.splice(cursor, 1); }
        else if (key === 'kill') { input = []; cursor = 0; }
        else if (key.startsWith('text:')) insert(key.slice(5));
        render();
    }

    const CSI_KEYS = { A: 'up', B: 'down', C: 'right', D: 'left', H: 'home', F: 'end' };
    const TILDE_KEYS = { 1: 'home', 7: 'home', 4: 'end', 8: 'end', 3: 'delete', 5: 'pgup', 6: 'pgdn' };
    const CTRL_KEYS = {
        '\x01': 'home', '\x02': 'pgup', '\x06': 'pgdn', '\x03': 'ctrlc', '\x04': 'ctrld', '\x05': 'end', '\x0c': 'ctrll', '\r': 'enter', '\n': 'newline',
        '\x15': 'kill', '\x19': 'ctrly', '\x7f': 'backspace', '\b': 'backspace',
    };

    function onData(chunk) {
        clearTimeout(escTimer);
        buffer += decoder.write(chunk);
        while (buffer && !closed) {
            if (buffer.startsWith(PASTE_START)) {
                const end = buffer.indexOf(PASTE_END, PASTE_START.length);
                if (end < 0) return;
                if (!busy) { insert(buffer.slice(PASTE_START.length, end)); render(); }
                buffer = buffer.slice(end + PASTE_END.length);
                continue;
            }
            if (buffer[0] === ESC) {
                const csi = buffer.match(/^\x1b\[([0-9;]*)([A-Za-z~])/);
                if (csi) {
                    const [sequence, params, final] = csi;
                    buffer = buffer.slice(sequence.length);
                    if ((final === 'u' && params.startsWith('13;')) || (final === '~' && ['13;2', '27;2;13'].includes(params))) onKey('newline');
                    else if (final === '~' && TILDE_KEYS[params.split(';')[0]]) onKey(TILDE_KEYS[params.split(';')[0]]);
                    else if (params === '1;2' && (final === 'A' || final === 'B')) onKey(final === 'A' ? 'sup' : 'sdown');
                    else if (CSI_KEYS[final]) onKey(CSI_KEYS[final]);
                    continue;
                }
                if (buffer.length === 1) { escTimer = setTimeout(() => { if (buffer === ESC) { buffer = ''; onKey('esc'); } }, 40); return; }
                if (/^\x1b\[[0-9;]*$/.test(buffer)) return;
                if (buffer[1] === '\r' || buffer[1] === '\n') { buffer = buffer.slice(2); onKey('newline'); continue; }
                if (buffer[1] === 'O' && buffer.length >= 3) { const key = CSI_KEYS[buffer[2]]; buffer = buffer.slice(3); if (key) onKey(key); continue; }
                buffer = buffer.slice(1);
                continue;
            }
            const character = String.fromCodePoint(buffer.codePointAt(0));
            buffer = buffer.slice(character.length);
            if (CTRL_KEYS[character]) onKey(CTRL_KEYS[character]);
            else if (character.codePointAt(0) >= 32) onKey(`text:${character}`);
        }
    }

    stdout.write(`${ESC}[?1049h${ESC}[?7l${ESC}[2J${ESC}[?2004h`);
    process.once('exit', restoreTerminal);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on('data', onData);
    stdout.on('resize', render);
    render();
    return finished;
}

module.exports = { runTui };
