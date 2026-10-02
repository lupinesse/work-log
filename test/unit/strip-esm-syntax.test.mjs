import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { stripEsmSyntax } from './_helpers.mjs';

describe('stripEsmSyntax', () => {
  const cases = [
    ['single-line import', "import { a } from './a.js';\nconst b = 1;", '\nconst b = 1;'],
    ['export const', 'export const x = 1;', 'const x = 1;'],
    ['export function', 'export function f() {}', 'function f() {}'],
    ['export async function', 'export async function f() {}', 'async function f() {}'],
    ['export class', 'export class C {}', 'class C {}'],
    ['plain source untouched', 'const y = 2;', 'const y = 2;'],
  ];
  for (const [name, input, expected] of cases) {
    it(name, () => assert.equal(stripEsmSyntax(input), expected));
  }
});
