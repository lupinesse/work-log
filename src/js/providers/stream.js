import { readEventStream } from '../sse.js'

/**
 * @typedef {object} StreamHandlers
 * @property {(role: string) => void} onStart - Called when the assistant turn
 *   begins (before any text). Safe to call more than once; callers should
 *   guard against duplicate starts.
 * @property {(text: string) => void} onDelta - Called with each incremental
 *   chunk of assistant text.
 * @property {(message: string) => void} onError - Called with a human-readable
 *   message when the request fails or the API returns an error event.
 */

/**
 * @typedef {object} InterpretedEvent
 * @property {'start'|'delta'|'error'|'ignore'} kind - What the event represents.
 * @property {string} [role] - Assistant role, present when `kind` is `start`.
 * @property {string} [text] - Text chunk, present when `kind` is `delta`.
 * @property {string} [message] - Error message, present when `kind` is `error`.
 */

/**
 * Run a streaming chat completion against a provider endpoint and dispatch the
 * decoded events to the supplied handlers.
 *
 * This is the shared transport used by every provider: it POSTs the request,
 * surfaces non-OK HTTP responses as errors, then reads the SSE body and routes
 * each event through the provider-specific `interpretEvent` translator.
 *
 * @param {object} request - The HTTP request description.
 * @param {string} request.endpoint - Absolute URL to POST to.
 * @param {Record<string, string>} request.headers - Request headers.
 * @param {object} request.body - JSON-serialisable request body.
 * @param {(payload: object) => InterpretedEvent} interpretEvent - Translates a
 *   raw SSE JSON payload into a provider-agnostic event.
 * @param {StreamHandlers} handlers - Callbacks for the decoded events.
 * @returns {Promise<void>} Resolves when streaming finishes (success or error).
 */
export const runChatStream = async ({ endpoint, headers, body }, interpretEvent, handlers) => {
    let response
    try {
        response = await fetch(endpoint, {
            method: 'POST',
            headers,
            body: JSON.stringify(body)
        })
    } catch (error) {
        handlers.onError(`Could not reach the API: ${error.message}`)
        return
    }

    if (!response.ok) {
        const data = await response.json().catch(() => null)
        const message = data?.error?.message || `Request failed with status ${response.status}.`
        handlers.onError(message)
        return
    }

    await readEventStream(response, payload => {
        const event = interpretEvent(payload)
        if (event.kind === 'start') {
            handlers.onStart(event.role)
        } else if (event.kind === 'delta') {
            handlers.onDelta(event.text)
        } else if (event.kind === 'error') {
            handlers.onError(event.message)
        }
    })
}
