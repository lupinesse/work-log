import { runChatStream } from './stream.js'

const MODELS_ENDPOINT = 'https://api.openai.com/v1/models'
const CHAT_ENDPOINT = 'https://api.openai.com/v1/chat/completions'

/**
 * Build the request headers for the OpenAI API.
 *
 * @param {string} apiKey - The user's OpenAI API key.
 * @returns {Record<string, string>} Headers including bearer authorisation.
 */
const buildHeaders = apiKey => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`
})

/**
 * Build the chat-completions request body for a streaming OpenAI call.
 *
 * The shared system message is prepended as a `system` role message, matching
 * the chat-completions convention.
 *
 * @param {object} options - Request options.
 * @param {string} options.model - Model id to use.
 * @param {string} options.systemMessage - The system prompt (may be empty).
 * @param {Array<{role: string, content: string}>} options.messages - The
 *   conversation turns, excluding the system message.
 * @returns {object} A JSON-serialisable request body.
 */
export const buildRequestBody = ({ model, systemMessage, messages }) => {
    const conversation = systemMessage
        ? [{ role: 'system', content: systemMessage }, ...messages]
        : [...messages]
    return {
        model,
        stream: true,
        messages: conversation
    }
}

/**
 * Translate an OpenAI streaming SSE payload into a provider-agnostic event.
 *
 * @param {object} payload - One parsed `data:` JSON object from the stream.
 * @returns {import('./stream.js').InterpretedEvent} The interpreted event.
 */
export const interpretEvent = payload => {
    if (payload.error) {
        return { kind: 'error', message: payload.error.message }
    }
    const delta = payload.choices?.[0]?.delta
    if (!delta) {
        return { kind: 'ignore' }
    }
    if (typeof delta.content === 'string' && delta.content.length > 0) {
        return { kind: 'delta', text: delta.content }
    }
    if (delta.role) {
        return { kind: 'start', role: delta.role }
    }
    return { kind: 'ignore' }
}

/**
 * The OpenAI provider definition. Conforms to the shared provider interface
 * consumed by the application and the provider registry.
 *
 * @type {import('./index.js').Provider}
 */
export const openai = {
    id: 'openai',
    label: 'OpenAI',
    apiKeyPlaceholder: 'sk-...',
    apiKeyHelpUrl: 'https://platform.openai.com/account/api-keys',
    apiKeyHelpLabel: 'OpenAI’s API key page',
    usageUrl: 'https://platform.openai.com/account/usage',
    models: [
        { value: 'gpt-4o', label: 'GPT-4o' },
        { value: 'gpt-4o-mini', label: 'GPT-4o mini' },
        { value: 'gpt-4.1', label: 'GPT-4.1' },
        { value: 'gpt-4.1-mini', label: 'GPT-4.1 mini' }
    ],

    /**
     * Check whether an API key is valid by listing models.
     *
     * @param {string} apiKey - The key to verify.
     * @returns {Promise<{ok: boolean, message?: string}>} Verification result.
     */
    verifyKey: async apiKey => {
        try {
            const response = await fetch(MODELS_ENDPOINT, { headers: buildHeaders(apiKey) })
            if (response.ok) {
                return { ok: true }
            }
            const data = await response.json().catch(() => null)
            if (data?.error?.code === 'invalid_api_key') {
                return { ok: false, message: 'This API key doesn’t work.' }
            }
            return { ok: false, message: 'There was an error when checking the API key.' }
        } catch {
            return { ok: false, message: 'There was an error when checking the API key.' }
        }
    },

    /**
     * Stream a chat completion from OpenAI.
     *
     * @param {string} apiKey - The user's OpenAI API key.
     * @param {object} options - Request options (model, systemMessage, messages).
     * @param {import('./stream.js').StreamHandlers} handlers - Event callbacks.
     * @returns {Promise<void>} Resolves when streaming finishes.
     */
    streamChat: (apiKey, options, handlers) =>
        runChatStream(
            {
                endpoint: CHAT_ENDPOINT,
                headers: buildHeaders(apiKey),
                body: buildRequestBody(options)
            },
            interpretEvent,
            handlers
        )
}
