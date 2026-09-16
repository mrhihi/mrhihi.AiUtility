/**
 * aiutility.js
 * 提供呼叫 OpenAI 相容的 Chat Completion 方法
 */
class AIUtility {
    /**
     * 建構 AIUtility 實例
     * @param {string} apiKey - OpenAI 的 API 金鑰
     * @param {string} [url='https://api.openai.com/v1'] - 自訂的 API URL
     * @param {string} [apiVersion=''] - API 版本 (例如 Azure OpenAI 需要指定版本)
     */
    constructor(apiKey, url = 'https://api.openai.com/v1', apiVersion = '') {
        this.apiKey = apiKey;
        this.url = url;
        this.apiVersion = apiVersion;
    }

    /**
     * 呼叫 OpenAI Chat Completion API 的方法
     * @param {string} model - 使用的模型名稱 (例如 "gpt-3.5-turbo")
     * @param {Array} messages - 聊天訊息的陣列，每個訊息包含 role 和 content
     * @param {number} [temperature=0.7] - 控制生成文字的隨機性
     * @param {number} [maxTokens=100] - 回應的最大 token 數
     * @returns {Promise<Object>} - 回傳 API 的回應資料
     */
    async callChatCompletion(model, messages, temperature = 0.7, maxTokens = 8192) {
        return this.#requestChatCompletion(model, messages, temperature, maxTokens, false);
    }

    /**
     * 優先使用 SSE streaming 呼叫 Chat Completion；服務不支援時退回一般 JSON。
     * @param {string} model
     * @param {Array} messages
     * @param {(text: string) => void|Promise<void>} [onDelta]
     * @param {number} [temperature=0.7]
     * @param {number} [maxTokens=8192]
     * @returns {Promise<Object>} 完整的 Chat Completion 回應
     */
    async callChatCompletionStream(model, messages, onDelta = () => {}, temperature = 0.7, maxTokens = 8192, signal = null) {
        const url = this.#chatUrl();
        const response = await fetch(url, {
            method: 'POST',
            headers: this.#headers(),
            ...(signal ? { signal } : {}),
            body: JSON.stringify({ model, messages, temperature, max_tokens: maxTokens, stream: true }),
        });

        if (!response.ok) {
            const error = await this.#responseError(response);
            if ([400, 404, 405, 415].includes(response.status)) {
                return this.#requestChatCompletion(model, messages, temperature, maxTokens, false, true, signal);
            }
            throw error;
        }

        const contentType = response.headers.get('content-type') || '';
        if (!contentType.toLowerCase().includes('text/event-stream') || !response.body) {
            return response.json();
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let content = '';

        const consumeEvent = async (event) => {
            const data = event.split(/\r?\n/)
                .filter(line => line.startsWith('data:'))
                .map(line => line.slice(5).trimStart())
                .join('\n');
            if (!data || data === '[DONE]') return data === '[DONE]';
            const chunk = JSON.parse(data);
            const delta = chunk.choices?.[0]?.delta?.content;
            if (delta) {
                content += delta;
                await onDelta(delta);
            }
            return false;
        };

        let done = false;
        while (!done) {
            const { value, done: streamDone } = await reader.read();
            buffer += decoder.decode(value || new Uint8Array(), { stream: !streamDone });
            const events = buffer.split(/\r?\n\r?\n/);
            buffer = events.pop() || '';
            for (const event of events) {
                if (await consumeEvent(event)) {
                    done = true;
                    break;
                }
            }
            if (streamDone) break;
        }
        if (!done && buffer.trim()) await consumeEvent(buffer);

        return { choices: [{ message: { role: 'assistant', content } }] };
    }

    #chatUrl() {
        const aoaiApiVer = this.apiVersion ? `?api-version=${encodeURIComponent(this.apiVersion)}` : '';
        return `${this.url}/chat/completions${aoaiApiVer}`;
    }

    #headers() {
        return {
            'Content-Type': 'application/json',
            ...(this.apiKey ? { 'Authorization': `Bearer ${this.apiKey}` } : {}),
        };
    }

    async #requestChatCompletion(model, messages, temperature, maxTokens, stream = false, quiet = false, signal = null) {
        const response = await fetch(this.#chatUrl(), {
            method: 'POST',
            headers: this.#headers(),
            ...(signal ? { signal } : {}),
            body: JSON.stringify({ model, messages, temperature, max_tokens: maxTokens, ...(stream ? { stream: true } : {}) }),
        });
        if (!response.ok) throw await this.#responseError(response, quiet);
        return response.json();
    }

    async #responseError(response, quiet = false) {
        let detail;
        try { detail = await response.json(); } catch { detail = await response.text(); }
        const message = typeof detail === 'string' ? detail : JSON.stringify(detail);
        const error = new Error(`HTTP ${response.status}: ${message}`);
        if (!quiet) error.apiError = detail;
        return error;
    }

    /**
     * 列出可用的模型
     * @returns {Promise<Object>} - 回傳可用模型的清單
     */
    async listModels() {
        const modelsUrl = `${this.url}/models`;
        try {
            const response = await fetch(modelsUrl, {
                method: 'GET',
                headers: this.#headers(),
            });

            if (!response.ok) throw await this.#responseError(response);

            return await response.json();
        } catch (error) {
            console.error('取得模型清單時發生錯誤:', error.message);
            throw error;
        }
    }
}

module.exports = AIUtility;

/**
 * 使用範例
 *
 * <script type="module">
 * import AIUtility from './aiutility.js';
 *
 * const ai = new AIUtility('your-api-key');
 *
 * const messages = [
 *     { role: 'system', content: '你是一個有幫助的助手。' },
 *     { role: 'user', content: '你好！' }
 * ];
 *
 * ai.callChatCompletion('gpt-3.5-turbo', messages)
 *   .then(response => console.log(response))
 *   .catch(error => console.error(error));
 * </script>
 */
