#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { exec } = require('child_process');
const AIUtility = require('./aiutility');

const args = process.argv.slice(2);
const COLORS = {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    cyan: '\x1b[36m',
    green: '\x1b[32m',
    blue: '\x1b[34m',
    yellow: '\x1b[33m',
    magenta: '\x1b[35m',
    white: '\x1b[37m',
    inputBackground: '\x1b[48;5;236m',
    aiBackground: '\x1b[48;5;24m',
};

function terminalColorsEnabled() { return Boolean(process.stdout.isTTY && process.env.NO_COLOR === undefined); }
function blockStyle(background) { return terminalColorsEnabled() ? `${background}${COLORS.white}` : ''; }
function resetStyle() { return terminalColorsEnabled() ? COLORS.reset : ''; }

function colorizeHelp(text) {
    if (!process.stdout.isTTY || process.env.NO_COLOR !== undefined) return text;
    const isArgument = token => /^<[^>]+>$|^\[[^\]]+\]$|^--?\w+|^(envfile|model|訊息)$|^[A-Z][A-Z0-9_]*=?/.test(token);
    const colorCommand = value => {
        const tokens = value.split(/(\s+)/);
        const words = tokens.filter(token => token.trim());
        const startsWithAi = words[0] === 'ai';
        const firstCommandIndex = startsWithAi ? 1 : 0;
        const hasNamespace = words[firstCommandIndex] === 'env';
        const hasEnvArgument = /^<[^>]+>$/.test(words[firstCommandIndex] || '');
        const secondLevelIndex = (hasNamespace || hasEnvArgument) ? firstCommandIndex + 1 : -1;
        let wordIndex = -1;
        return tokens.map(token => {
            if (!token.trim()) return token;
            wordIndex++;
            if (isArgument(token)) return `${COLORS.yellow}${token}${COLORS.reset}`;
            if (wordIndex === secondLevelIndex) return `${COLORS.blue}${token}${COLORS.reset}`;
            return `${COLORS.green}${token}${COLORS.reset}`;
        }).join('');
    };
    return text.split('\n').map(line => {
        if (/^(使用方式|指令說明|參數|環境變數|env 管理|互動模式|範例|指令|可設定欄位)：/.test(line)) {
            return `${COLORS.bold}${COLORS.cyan}${line}${COLORS.reset}`;
        }
        const columns = line.match(/^(\s+)(.*?)(\s{2,})(\S.*)$/);
        if (columns) {
            const [, indent, left, gap, description] = columns;
            return `${indent}${colorCommand(left)}${gap}${COLORS.white}${description}${COLORS.reset}`;
        }
        if (/^\s*(ai\b|\/)/.test(line)) return colorCommand(line);
        return line;
    }).join('\n');
}

const HELP = `使用方式：
  ai help | ai --help
  ai env help
  ai env ls
  ai env cat <envfile>
  ai env show <envfile>
  ai env add <envfile> KEY=VALUE [...]
  ai env set <envfile> KEY=VALUE [...]
  ai env delete <envfile> [--yes]
  ai code
  ai <envfile> ls
  ai <envfile> ask [model] "訊息"
  ai <envfile> chat [model]

指令說明：
  env ls             列出環境設定檔
  env cat            顯示環境設定檔完整內容
  env help           顯示 env 管理說明
  env show           顯示環境設定（API_KEY 會遮罩）
  env add            新增環境設定檔
  env set            修改環境設定檔中的欄位
  env delete         刪除環境設定檔
  ls                 列出環境設定檔，或列出 API 模型
  cat <envfile>      顯示環境設定檔內容
  code               在 VS Code 開啟 AiUtility 目錄
  ask                發送一次性問題，優先使用 streaming 回覆
  chat               啟動互動式聊天並保存 session

參數：
  envfile            不含 .env 的環境設定檔名稱，例如 gssdev
  model              模型名稱；省略時使用 DEFAULT_MODEL
  訊息               ask 的提問內容，可用引號包住

環境變數：
  API_KEY            API 金鑰（可省略，視服務需求）
  AI_HOST            OpenAI 相容 API 的 base URL
  API_VERSION        Azure OpenAI API 版本（可省略）
  DEFAULT_MODEL      預設模型名稱

env 管理：
  支援的欄位為 API_KEY、AI_HOST、API_VERSION、DEFAULT_MODEL。
  KEY=VALUE 中的 VALUE 可以包含等號；API_KEY 不會在 show 中顯示完整內容。
  delete 預設會要求確認，腳本使用時加上 --yes。

互動模式：
  Enter 送出訊息；Shift+Enter 換行；貼上多行文字後按 Enter 送出。
  /resume            列出並恢復目前環境的 session
  /new               建立新的空白 session
  /list              列出目前環境的 session
  /delete            選取並確認刪除 session
  /info              顯示目前使用模型的資訊
  /model [model]     查看或切換目前使用的模型
  /help 或 ?         顯示互動模式說明
  /exit              離開互動模式
  Ctrl-D / Ctrl-C    離開互動模式

範例：
  ai env ls
  ai env cat gssdev
  ai gssdev ls
  ai gssdev ask "你好嗎？"
  ai gssdev ask phi-4-q4 "請摘要這段文字"
  ai gssdev chat
  ai gssdev chat phi-4-q4`;

const SESSION_DIR = path.join(os.homedir(), '.aiutility', 'sessions');
const SYSTEM_MESSAGE = { role: 'system', content: '用正體中文台灣用語回答' };
const ENV_KEYS = ['API_KEY', 'AI_HOST', 'API_VERSION', 'DEFAULT_MODEL'];
const INTERACTIVE_HELP = `互動模式說明：
  Enter              送出訊息
  Shift+Enter        在訊息中換行
  貼上多行文字       會保留在同一則訊息，按 Enter 後才送出
  /resume            列出並恢復目前環境的 session
  /new               建立新的空白 session
  /list              列出目前環境的 session
  /delete            選取並確認刪除 session
  /info              顯示目前使用模型的資訊
  /model [model]     查看或切換目前使用的模型
  /help 或 ?         顯示互動模式說明
  /exit              離開互動模式
  Ctrl-D / Ctrl-C    離開互動模式`;
const ENV_HELP = `env 管理使用方式：
  ai env help
  ai env ls
  ai env cat <envfile>
  ai env show <envfile>
  ai env add <envfile> KEY=VALUE [...]
  ai env set <envfile> KEY=VALUE [...]
  ai env delete <envfile> [--yes]

指令：
  ls                 列出所有環境設定檔
  cat <envfile>      顯示環境設定檔完整內容
  show <envfile>     顯示環境設定（API_KEY 會遮罩）
  add <envfile>      新增環境設定檔
  set <envfile>      修改環境設定檔中的欄位
  delete <envfile>   刪除環境設定檔；加 --yes 跳過確認

可設定欄位：API_KEY、AI_HOST、API_VERSION、DEFAULT_MODEL

範例：
  ai env ls
  ai env add gssdev API_KEY=xxx AI_HOST=https://example.com/v1 DEFAULT_MODEL=gpt-4o
  ai env set gssdev DEFAULT_MODEL=gpt-4.1-mini
  ai env show gssdev`;

function envPath(name) { return path.join(__dirname, `${name}.env`); }
function printHelp() { console.log(colorizeHelp(HELP)); }
function validateEnvName(name) {
    if (!name || !/^[A-Za-z0-9_-]+$/.test(name)) throw new Error('envfile 只能包含英文字母、數字、底線或連字號。');
}
function readEnvValues(name) {
    const file = envPath(name);
    if (!fs.existsSync(file)) throw new Error(`環境變數檔案 ${file} 不存在。`);
    const values = {};
    fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach(line => {
        const match = line.replace(/^\uFEFF/, '').match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
        if (match) values[match[1]] = match[2];
    });
    return values;
}
function parseEnvAssignments(assignments) {
    if (!assignments.length) throw new Error(`請提供設定，例如 API_KEY=xxx AI_HOST=https://example.com/v1`);
    const values = {};
    assignments.forEach(assignment => {
        const separator = assignment.indexOf('=');
        if (separator <= 0) throw new Error(`設定「${assignment}」格式錯誤，應為 KEY=VALUE。`);
        const key = assignment.slice(0, separator).trim().replace(/^\uFEFF/, '');
        const value = assignment.slice(separator + 1);
        if (!ENV_KEYS.includes(key)) throw new Error(`不支援的欄位「${key}」，可用欄位：${ENV_KEYS.join(', ')}`);
        values[key] = value;
    });
    return values;
}
function writeEnvValues(name, values) {
    fs.writeFileSync(envPath(name), ENV_KEYS.filter(key => Object.prototype.hasOwnProperty.call(values, key))
        .map(key => `${key}=${values[key]}`).join('\n') + '\n', { mode: 0o600 });
}
function maskedValue(key, value) {
    if (key !== 'API_KEY' || !value) return value || '';
    return value.length <= 8 ? '********' : `${value.slice(0, 4)}...${value.slice(-4)}`;
}
function printEnv(name) {
    const values = readEnvValues(name);
    console.log(`環境設定：${name}`);
    ENV_KEYS.forEach(key => { if (Object.prototype.hasOwnProperty.call(values, key)) console.log(`${key}=${maskedValue(key, values[key])}`); });
}
async function manageEnv(commandArgs) {
    const action = commandArgs[0] || 'help';
    if (['help', '--help', '-h'].includes(action)) { console.log(colorizeHelp(ENV_HELP)); return; }
    if (action === 'list' || action === 'ls') {
        fs.readdirSync(__dirname).filter(file => file.endsWith('.env')).sort().forEach(file => console.log(file.replace(/\.env$/, '')));
        return;
    }
    const name = commandArgs[1];
    validateEnvName(name);
    const file = envPath(name);
    if (['cat'].includes(action)) {
        if (!fs.existsSync(file)) throw new Error(`環境變數檔案 ${file} 不存在。`);
        console.log(fs.readFileSync(file, 'utf8'));
        return;
    }
    if (['show', 'get'].includes(action)) { printEnv(name); return; }
    if (['add', 'create'].includes(action)) {
        if (fs.existsSync(file)) throw new Error(`環境設定「${name}」已存在，請使用 set 修改。`);
        writeEnvValues(name, parseEnvAssignments(commandArgs.slice(2)));
        console.log(`已新增環境設定：${name}`);
        return;
    }
    if (['set', 'update', 'edit'].includes(action)) {
        const values = { ...readEnvValues(name), ...parseEnvAssignments(commandArgs.slice(2)) };
        writeEnvValues(name, values);
        console.log(`已更新環境設定：${name}`);
        return;
    }
    if (['delete', 'remove', 'rm'].includes(action)) {
        if (!fs.existsSync(file)) throw new Error(`環境設定檔 ${file} 不存在。`);
        const confirmed = commandArgs.includes('--yes') || commandArgs.includes('-y');
        if (!confirmed) {
            const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
            try {
                const answer = await askInput(rl, `確定刪除環境設定「${name}」？(y/N) `);
                if (answer === null || answer.trim().toLowerCase() !== 'y') { console.log('已取消刪除。'); return; }
            } finally { rl.close(); }
        }
        fs.unlinkSync(file);
        console.log(`已刪除環境設定：${name}`);
        return;
    }
    throw new Error(`不支援的 env 操作「${action}」，請使用 ai --help 查看說明。`);
}
function askInput(rl, prompt) {
    return new Promise(resolve => {
        let settled = false;
        const finish = value => {
            if (settled) return;
            settled = true;
            rl.removeListener('close', onClose);
            resolve(value);
        };
        const onClose = () => finish(null);
        rl.once('close', onClose);
        rl.question(prompt, answer => finish(answer));
    });
}

function readTerminalInput(prompt, rl) {
    if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') return askInput(rl, prompt);
    return new Promise(resolve => {
        const stdin = process.stdin;
        const pasteStart = '\x1b[200~';
        const pasteEnd = '\x1b[201~';
        const shiftEnter = ['\x1b[13;2u', '\x1b[13;2~', '\x1b[27;2;13~'];
        let buffer = '';
        let value = '';
        let closed = false;
        const cleanup = result => {
            if (closed) return;
            closed = true;
            stdin.removeListener('data', onData);
            stdin.setRawMode(false);
            if (result !== null) process.stdout.write('\n');
            process.stdout.write(resetStyle());
            process.stdout.write('\x1b[?2004l');
            resolve(result);
        };
        const echoNewline = () => process.stdout.write('\n  › ');
        const onData = chunk => {
            buffer += chunk.toString('utf8');
            while (buffer) {
                if (buffer.startsWith(pasteStart)) {
                    const end = buffer.indexOf(pasteEnd, pasteStart.length);
                    if (end < 0) return;
                    const pasted = buffer.slice(pasteStart.length, end).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
                    value += pasted;
                    process.stdout.write(pasted.replace(/\n/g, '\n  › '));
                    buffer = buffer.slice(end + pasteEnd.length);
                    continue;
                }
                const matchedShiftEnter = shiftEnter.find(sequence => buffer.startsWith(sequence));
                if (matchedShiftEnter) {
                    value += '\n';
                    echoNewline();
                    buffer = buffer.slice(matchedShiftEnter.length);
                    continue;
                }
                if (buffer.startsWith('\x1b')) {
                    if (buffer.length === 1) return;
                    buffer = buffer.slice(1);
                    continue;
                }
                const character = buffer[0];
                buffer = buffer.slice(1);
                if (character === '\u0003' || character === '\u0004') { cleanup(null); return; }
                if (character === '\r' || character === '\n') { cleanup(value); return; }
                if (character === '\u007f' || character === '\b') {
                    if (value) { value = [...value].slice(0, -1).join(''); process.stdout.write('\b \b'); }
                    continue;
                }
                value += character;
                process.stdout.write(character);
            }
        };
        stdin.setRawMode(true);
        stdin.resume();
        process.stdout.write('\x1b[?2004h');
        process.stdout.write(prompt);
        stdin.on('data', onData);
    });
}

function watchEscape(controller) {
    if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') return () => {};
    const onData = chunk => {
        const input = chunk.toString('utf8');
        if (input.includes('\x1b') || input.includes('\u0003')) controller.abort();
    };
    process.stdin.setRawMode(true);
    process.stdin.on('data', onData);
    return () => {
        process.stdin.removeListener('data', onData);
        process.stdin.setRawMode(false);
    };
}

function sessionFiles(envfile) {
    if (!fs.existsSync(SESSION_DIR)) return [];
    return fs.readdirSync(SESSION_DIR).filter(file => file.endsWith('.json')).map(file => {
        try { return JSON.parse(fs.readFileSync(path.join(SESSION_DIR, file), 'utf8')); } catch { return null; }
    }).filter(session => session && session.envfile === envfile).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

function saveSession(session) {
    fs.mkdirSync(SESSION_DIR, { recursive: true, mode: 0o700 });
    const file = path.join(SESSION_DIR, `${session.id}.json`);
    const temporary = `${file}.tmp-${process.pid}`;
    fs.writeFileSync(temporary, `${JSON.stringify(session, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporary, file);
}

function sessionSummary(session, index) {
    const firstUser = session.messages.find(message => message.role === 'user');
    const summary = (firstUser?.content || '空白 session').replace(/\s+/g, ' ').slice(0, 48);
    return `${index + 1}. ${session.id}  ${session.updatedAt}  ${summary}`;
}

function printResult(text) {
    console.log('\n結果：');
    text.split('\n').forEach(line => console.log(`  ${line}`));
}

function chatHeading(title, background = COLORS.aiBackground) {
    console.log(`\n${blockStyle(background)}${title}${resetStyle()}`);
}

async function chooseSession(readLine, envfile, action = '恢復') {
    const sessions = sessionFiles(envfile);
    if (!sessions.length) { printResult('目前沒有可用的 session。'); return null; }
    console.log(`\n結果：\n  可用的 session（${action}）：`);
    sessions.forEach(session => console.log(`  ${sessionSummary(session, sessions.indexOf(session))}`));
    const answer = await readLine(`\n  › 請輸入編號（1-${sessions.length}，直接 Enter 取消）：`);
    if (answer === null || !answer.trim()) return null;
    const index = Number(answer) - 1;
    if (!Number.isInteger(index) || index < 0 || index >= sessions.length) { console.log('無效的 session 編號。'); return null; }
    return sessions[index];
}

function newSession(envfile, model) {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date().toISOString();
    return { id, envfile, model, createdAt: now, updatedAt: now, messages: [{ ...SYSTEM_MESSAGE }] };
}

async function runOneShot(ai, model, message) {
    let streamed = false;
    const response = await ai.callChatCompletionStream(model, [SYSTEM_MESSAGE, { role: 'user', content: message }], text => {
        streamed = true; process.stdout.write(text);
    });
    if (!streamed) process.stdout.write(response.choices?.[0]?.message?.content || '');
    process.stdout.write('\n');
}

async function runChat(ai, envfile, model) {
    // raw mode 由 readTerminalInput 自己處理回顯，避免 readline 再回顯一次造成字元重複。
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });
    const readLine = prompt => readTerminalInput(prompt, rl);
    let session = newSession(envfile, model);
    console.log(`\n對話 session：${session.id}`);
    console.log(`目前模型：${model}`);
    console.log('Enter 送出、Shift+Enter 換行；輸入 /help 查看指令。');
    const close = () => rl.close();
    rl.on('SIGINT', close);
    try {
        while (true) {
            console.log(`\n${blockStyle(COLORS.inputBackground)}輸入訊息：${resetStyle()}`);
            const line = await readLine('  › ');
            if (line === null) break;
            if (!process.stdin.isTTY) process.stdout.write('\n');
            if (line.trim() === '?' || line.trim().startsWith('/')) {
                const commandParts = line.trim().split(/\s+/);
                const command = commandParts[0] === '?' ? '/help' : commandParts[0];
                if (command === '/exit' || command === '/quit') break;
                if (command === '/help') { printResult(colorizeHelp(INTERACTIVE_HELP)); continue; }
                if (command === '/new') { session = newSession(envfile, model); printResult(`已建立新的 session：${session.id}`); continue; }
                if (command === '/list') {
                    const list = sessionFiles(envfile);
                    printResult(list.length ? list.map(sessionSummary).join('\n') : '目前沒有已保存的 session。');
                    continue;
                }
                if (command === '/info') { await printCurrentModelInfo(ai, model); continue; }
                if (command === '/model') {
                    const selectedModel = commandParts[1];
                    if (!selectedModel) { await printAvailableModels(ai, model); continue; }
                    try {
                        const models = await ai.listModels();
                        const exists = (models.data || []).some(item => item.id === selectedModel);
                        if (!exists) {
                            printResult(`找不到模型：${selectedModel}\n目前仍使用：${model}`);
                            continue;
                        }
                    } catch (error) {
                        printResult(`無法驗證模型：${selectedModel}\n目前仍使用：${model}\n原因：${error.message}`);
                        continue;
                    }
                    model = selectedModel;
                    session.model = model;
                    session.updatedAt = new Date().toISOString();
                    saveSession(session);
                    printResult(`已切換模型：${model}`);
                    continue;
                }
                if (command === '/resume') {
                    const selected = await chooseSession(readLine, envfile);
                    if (selected) { session = selected; model = session.model; console.log(`  已恢復 session：${session.id}`); }
                    continue;
                }
                if (command === '/delete') {
                    const selected = await chooseSession(readLine, envfile, '刪除');
                    if (selected) {
                        const confirm = await readLine(`\n  › 確定刪除 ${selected.id}？(y/N) `);
                        if (confirm && confirm.trim().toLowerCase() === 'y') { fs.unlinkSync(path.join(SESSION_DIR, `${selected.id}.json`)); console.log('  session 已刪除。'); }
                        else console.log('  已取消刪除。');
                    }
                    continue;
                }
                printResult('未知的互動指令，請輸入 /help。');
                continue;
            }
            if (!line.trim()) continue;
            const message = line;
            session.messages.push({ role: 'user', content: message });
            let streamed = false;
            let atLineStart = true;
            chatHeading('AI 回覆');
            process.stdout.write('  ⏳ AI 回覆中...');
            const responsePrefix = process.stdout.isTTY ? '\r\x1b[2K' : '\r';
            const writeIndented = text => {
                let output = '';
                for (const character of text) {
                    if (atLineStart) output += '  ';
                    output += character;
                    atLineStart = character === '\n';
                }
                process.stdout.write(output);
            };
            const controller = new AbortController();
            const stopWatchingEscape = watchEscape(controller);
            try {
                const response = await ai.callChatCompletionStream(model, session.messages, text => {
                    if (!streamed) process.stdout.write(responsePrefix);
                    streamed = true;
                    writeIndented(text);
                }, 0.7, 8192, controller.signal);
                const content = response.choices?.[0]?.message?.content || '';
                if (!streamed) { process.stdout.write(responsePrefix); writeIndented(content); }
                if (!atLineStart) process.stdout.write('\n');
                process.stdout.write(resetStyle());
                session.messages.push({ role: 'assistant', content });
                session.updatedAt = new Date().toISOString();
                saveSession(session);
            } catch (error) {
                session.messages.pop();
                if (controller.signal.aborted) process.stdout.write(`\n${resetStyle()}已中斷 AI 回覆。\n`);
                else process.stdout.write(`\n${resetStyle()}API 呼叫失敗：${error.message}\n`);
            } finally { stopWatchingEscape(); }
        }
    } finally { rl.close(); }
    console.log('已離開互動模式。');
}

function printModels(ai) { return ai.listModels().then(models => (models.data || []).forEach(model => console.log(`${model.owned_by || ''}\t${model.id}`))); }

async function printCurrentModelInfo(ai, model) {
    try {
        const models = await ai.listModels();
        const info = (models.data || []).find(item => item.id === model);
        if (!info) {
            printResult(`目前使用模型：${model}\nAPI 模型清單中找不到此模型的詳細資訊。`);
            return;
        }
        const details = Object.entries(info)
            .map(([key, value]) => `${key}: ${formatModelInfoValue(key, value)}`)
            .join('\n');
        printResult(`目前使用模型：${model}\n${details}`);
    } catch (error) {
        printResult(`目前使用模型：${model}\n無法取得模型資訊：${error.message}`);
    }
}

async function printAvailableModels(ai, currentModel) {
    try {
        const models = await ai.listModels();
        const lines = (models.data || []).map(item => `${item.id === currentModel ? '* ' : '  '}${item.id}`);
        printResult(`目前模型：${currentModel}\n${lines.length ? lines.join('\n') : 'API 沒有回傳可用模型。'}`);
    } catch (error) {
        printResult(`目前模型：${currentModel}\n無法取得模型清單：${error.message}`);
    }
}

function formatModelInfoValue(key, value) {
    if (key === 'created' && typeof value === 'number') {
        return `${new Date(value * 1000).toLocaleString('zh-TW', {
            timeZone: 'Asia/Taipei',
            hour12: false,
        })} (${value})`;
    }
    return typeof value === 'object' ? JSON.stringify(value) : value;
}

async function main() {
    if (!args.length || ['help', '--help', '-h'].includes(args[0])) { printHelp(); return; }
    if (args[0] === 'env') { return manageEnv(args.slice(1)); }
    if (args[0] === 'code') { exec('code .', { cwd: __dirname }, error => { if (error) console.error(`無法打開 VS Code: ${error.message}`); }); return; }

    const envfile = args[0];
    const file = envPath(envfile);
    if (!fs.existsSync(file)) throw new Error(`環境變數檔案 ${file} 不存在。`);
    require('dotenv').config({ path: file });
    const ai = new AIUtility(process.env.API_KEY, process.env.AI_HOST, process.env.API_VERSION || '');
    const method = args[1];
    if (method === 'ls') return printModels(ai);
    if (method !== 'ask' && method !== 'chat') throw new Error(`不支援的方法「${method || ''}」，請使用 ai --help 查看說明。`);

    let model;
    let message;
    if (method === 'chat') {
        model = args[2] || process.env.DEFAULT_MODEL;
        if (args.length > 3) throw new Error('chat 不接受訊息參數；請使用 ask 發送一次性問題。');
    } else {
        model = args.length >= 4 ? args[2] : process.env.DEFAULT_MODEL;
        message = args.length >= 4 ? args.slice(3).join(' ') : args.slice(2).join(' ');
    }
    if (!model) throw new Error('請提供模型名稱，或在 envfile 設定 DEFAULT_MODEL。');
    if (method === 'ask') { if (!message) throw new Error('請提供訊息，例如：ai env ask "你好嗎？"'); return runOneShot(ai, model, message); }
    return runChat(ai, envfile, model);
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
