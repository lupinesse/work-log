import { test } from 'node:test'
import assert from 'node:assert/strict'

import * as openai from '../src/js/providers/openai.js'
import * as anthropic from '../src/js/providers/anthropic.js'

test('openai.buildRequestBody prepends the system message and enables streaming', () => {
    const body = openai.buildRequestBody({
        model: 'gpt-4o',
        systemMessage: 'be helpful',
        messages: [{ role: 'user', content: 'hi' }]
    })
    assert.equal(body.model, 'gpt-4o')
    assert.equal(body.stream, true)
    assert.deepEqual(body.messages, [
        { role: 'system', content: 'be helpful' },
        { role: 'user', content: 'hi' }
    ])
})

test('openai.buildRequestBody omits the system message when empty', () => {
    const body = openai.buildRequestBody({
        model: 'gpt-4o',
        systemMessage: '',
        messages: [{ role: 'user', content: 'hi' }]
    })
    assert.deepEqual(body.messages, [{ role: 'user', content: 'hi' }])
})

test('openai.interpretEvent maps roles, content, errors and noise', () => {
    assert.deepEqual(openai.interpretEvent({ choices: [{ delta: { role: 'assistant' } }] }), {
        kind: 'start',
        role: 'assistant'
    })
    assert.deepEqual(openai.interpretEvent({ choices: [{ delta: { content: 'hello' } }] }), {
        kind: 'delta',
        text: 'hello'
    })
    assert.deepEqual(openai.interpretEvent({ error: { message: 'bad key' } }), {
        kind: 'error',
        message: 'bad key'
    })
    assert.deepEqual(openai.interpretEvent({ choices: [{ delta: {} }] }), { kind: 'ignore' })
})

test('anthropic.buildRequestBody sets max_tokens and caches a non-empty system prompt', () => {
    const body = anthropic.buildRequestBody({
        model: 'claude-opus-4-7',
        systemMessage: 'be helpful',
        messages: [{ role: 'user', content: 'hi' }]
    })
    assert.equal(body.model, 'claude-opus-4-7')
    assert.equal(body.stream, true)
    assert.ok(typeof body.max_tokens === 'number' && body.max_tokens > 0)
    assert.deepEqual(body.system, [
        { type: 'text', text: 'be helpful', cache_control: { type: 'ephemeral' } }
    ])
})

test('anthropic.buildRequestBody omits the system field when empty', () => {
    const body = anthropic.buildRequestBody({
        model: 'claude-opus-4-7',
        systemMessage: '',
        messages: [{ role: 'user', content: 'hi' }]
    })
    assert.equal('system' in body, false)
})

test('anthropic.interpretEvent maps the Messages streaming events', () => {
    assert.deepEqual(anthropic.interpretEvent({ type: 'message_start' }), {
        kind: 'start',
        role: 'assistant'
    })
    assert.deepEqual(
        anthropic.interpretEvent({
            type: 'content_block_delta',
            delta: { type: 'text_delta', text: 'hello' }
        }),
        { kind: 'delta', text: 'hello' }
    )
    assert.deepEqual(anthropic.interpretEvent({ type: 'error', error: { message: 'overloaded' } }), {
        kind: 'error',
        message: 'overloaded'
    })
    assert.deepEqual(anthropic.interpretEvent({ type: 'ping' }), { kind: 'ignore' })
})
