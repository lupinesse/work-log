import { test } from 'node:test'
import assert from 'node:assert/strict'

import { parseHashParams } from '../src/js/utils.js'

test('parseHashParams returns an empty object for an empty hash', () => {
    assert.deepEqual(parseHashParams(''), {})
    assert.deepEqual(parseHashParams('#'), {})
})

test('parseHashParams decodes a single q parameter', () => {
    assert.deepEqual(parseHashParams('#q=hello%20there'), { q: 'hello there' })
})

test('parseHashParams parses multiple parameters', () => {
    assert.deepEqual(parseHashParams('a=1&b=2'), { a: '1', b: '2' })
})

test('parseHashParams tolerates a key with no value', () => {
    assert.deepEqual(parseHashParams('#flag'), { flag: '' })
})
