import { runChatStream } from './stream.js'

const MODELS_ENDPOINT = 'https://api.anthropic.com/v1/models'
const MESSAGES_ENDPOINT = 'https://api.anthropic.com/v1/messages'
const API_VERSION = '2023-06-01'

// Anthropic requires a max output token ceiling on every request. 4096 is a
// generous default for an interactive chat turn without risking timeouts.
const MAX_TOKENS = 4096

/**
 * Build the request headers for the Anthropic API.
 *
 * `anthropic-dangerous-direct-browser-access` opts in to browser-origin
 * requests (Anthropic blocks them by default to discourage leaking keys). This
 * app is explicitly bring-your-own-key, so the user's own key is sent only to
 * Anthropic from their own browser.
 *
 * @param {string} apiKey - The user's Anthropic API key.
 * @returns {Record<string, string>} Request headers.
 */
const buildHeaders = apiKey => ({
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': API_VERSION,
    'anthropic-dangerous-direct-browser-access': 'true'
})

/**
 * Build the Messages API request body for a streaming Anthropic call.
 *
 * The system prompt is sent as a top-level `system` field (not a message) and,
 * when present, is wrapped in a cache-control block so repeated turns reuse the
 * cached prefix. The system field is omitted entirely when empty, since the API
 * rejects empty system content.
 *
 * @param {object} options - Request options.
 * @param {string} options.model - Model id to use.
 * @param {string} options.systemMessage - The system prompt (may be empty).
 * @param {Array<{role: string, content: string}>} options.messages - The
 *   conversation turns, excluding the system message. Must start with a `user`
 *   turn and alternate roles.
 * @returns {object} A JSON-serialisable request body.
 */
export const buildRequestBody = ({ model, systemMessage, messages }) => {
    const body = {
        model,
        max_tokens: MAX_TOKENS,
        stream: true,
        messages
    }
    if (systemMessage) {
        body.system = [
            {
                type: 'text',
                text: systemMessage,
                cache_control: { type: 'ephemeral' }
            }
        ]
    }
    return body
}

/**
 * Translate an Anthropic streaming SSE payload into a provider-agnostic event.
 *
 * @param {object} payload - One parsed `data:` JSON object from the stream.
 * @returns {import('./stream.js').InterpretedEvent} The interpreted event.
 */
export const interpretEvent = payload => {
    switch (payload.type) {
        case 'message_start':
            return { kind: 'start', role: 'assistant' }
        case 'content_block_delta':
            if (payload.delta?.type === 'text_delta') {
                return { kind: 'delta', text: payload.delta.text }
            }
            return { kind: 'ignore' }
        case 'error':
            return { kind: 'error', message: payload.error?.message || 'API error.' }
        default:
            return { kind: 'ignore' }
    }
}

/**
 * The Anthropic (Claude) provider definition. Conforms to the shared provider
 * interface consumed by the application and the provider registry.
 *
 * @type {import('./index.js').Provider}
 */
export const anthropic = {
    id: 'anthropic',
    label: 'Claude',
    apiKeyPlaceholder: 'sk-ant-...',
    apiKeyHelpUrl: 'https://console.anthropic.com/settings/keys',
    apiKeyHelpLabel: 'Anthropic Console API keys page',
    usageUrl: 'https://console.anthropic.com/settings/usage',
    models: [
        { value: 'claude-opus-4-7', label: 'Claude Opus 4.7' },
        { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
        { value: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' }
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
            if (data?.error?.type === 'authentication_error') {
                return { ok: false, message: 'This API key doesn’t work.' }
            }
            return { ok: false, message: 'There was an error when checking the API key.' }
        } catch {
            return { ok: false, message: 'There was an error when checking the API key.' }
        }
    },

    /**
     * Stream a message completion from Anthropic.
     *
     * @param {string} apiKey - The user's Anthropic API key.
     * @param {object} options - Request options (model, systemMessage, messages).
     * @param {import('./stream.js').StreamHandlers} handlers - Event callbacks.
     * @returns {Promise<void>} Resolves when streaming finishes.
     */
    streamChat: (apiKey, options, handlers) =>
        runChatStream(
            {
                endpoint: MESSAGES_ENDPOINT,
                headers: buildHeaders(apiKey),
                body: buildRequestBody(options)
            },
            interpretEvent,
            handlers
        )
}
