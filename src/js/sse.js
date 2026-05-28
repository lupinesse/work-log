/**
 * Read a `fetch` response body as a Server-Sent Events stream and invoke a
 * callback with the parsed JSON payload of every non-empty `data:` line.
 *
 * Both the OpenAI and Anthropic streaming APIs frame their output as SSE where
 * each event's payload is a single-line JSON object on a `data:` line, so a
 * shared reader works for both. `event:` lines and comments are ignored — the
 * relevant discriminator (`choices`/`type`) lives inside the JSON payload.
 *
 * @param {Response} response - A streaming `fetch` response with a readable body.
 * @param {(payload: object) => void} onData - Called once per parsed JSON event.
 * @returns {Promise<void>} Resolves when the stream ends or a `[DONE]` sentinel
 *   is received.
 */
export const readEventStream = async (response, onData) => {
    const reader = response.body.getReader()
    const decoder = new TextDecoder('utf-8')
    let buffer = ''

    for (;;) {
        const { done, value } = await reader.read()
        if (done) {
            return
        }
        buffer += decoder.decode(value, { stream: true })

        let newlineIndex = buffer.indexOf('\n')
        while (newlineIndex !== -1) {
            const line = buffer.slice(0, newlineIndex).trim()
            buffer = buffer.slice(newlineIndex + 1)
            newlineIndex = buffer.indexOf('\n')

            if (!line.startsWith('data:')) {
                continue
            }
            const payload = line.slice('data:'.length).trim()
            if (!payload || payload === '[DONE]') {
                if (payload === '[DONE]') {
                    return
                }
                continue
            }
            try {
                onData(JSON.parse(payload))
            } catch (error) {
                // SSE frames are newline-delimited single-line JSON, so a parse
                // failure means a malformed chunk rather than a partial frame.
                // Skip it rather than aborting the whole stream.
                console.warn('Skipping unparseable SSE payload:', error)
            }
        }
    }
}
