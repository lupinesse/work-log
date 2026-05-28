import { test } from 'node:test'
import assert from 'node:assert/strict'

import { readEventStream } from '../src/js/sse.js'

/**
 * Build a streaming Response from an SSE-formatted string. Relies on the global
 * Response/ReadableStream available in Node 18+.
 *
 * @param {string} text - The raw SSE body.
 * @returns {Response} A response whose body streams the text.
 */
const sseResponse = text => new Response(text)

test('readEventStream parses data lines and stops at [DONE]', async () => {
    const body = [
        'data: {"n":1}',
        '',
        'data: {"n":2}',
        '',
        'data: [DONE]',
        'data: {"n":3}',
        ''
    ].join('\n')

    const received = []
    await readEventStream(sseResponse(body), payload => received.push(payload.n))
    assert.deepEqual(received, [1, 2])
})

test('readEventStream ignores event and comment lines', async () => {
    const body = ['event: message_start', 'data: {"type":"message_start"}', '', ': keep-alive', ''].join(
        '\n'
    )
    const received = []
    await readEventStream(sseResponse(body), payload => received.push(payload.type))
    assert.deepEqual(received, ['message_start'])
})
