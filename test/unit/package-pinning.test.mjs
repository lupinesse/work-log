/**
 * @file package-pinning.test.mjs
 * Guard for #485: CLAUDE.md and CONTRIBUTING.md say dependencies are pinned, so
 * every spec in package.json must be an exact version that matches the version
 * the committed lockfile resolves. Dependabot bumps exact pins.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { __dirname } from './_helpers.mjs';

const rootDirectory = join(__dirname, '../..');
const packageJson = JSON.parse(readFileSync(join(rootDirectory, 'package.json'), 'utf8'));
const lockfile = JSON.parse(readFileSync(join(rootDirectory, 'package-lock.json'), 'utf8'));

const EXACT_VERSION = /^\d+\.\d+\.\d+$/;

/**
 * Lists every declared dependency with the section it was declared in.
 * @returns {Array<{section: string, name: string, spec: string}>} One row per dependency.
 */
function declaredDependencies() {
  return ['dependencies', 'devDependencies', 'optionalDependencies'].flatMap((section) =>
    Object.entries(packageJson[section] ?? {}).map(([name, spec]) => ({ section, name, spec }))
  );
}

describe('package.json dependency pinning (#485)', () => {
  const dependencies = declaredDependencies();

  it('declares at least the known dev tooling (guards against reading the wrong file)', () => {
    assert.ok(dependencies.length >= 10, `only found ${dependencies.length} dependencies`);
  });

  for (const { section, name, spec } of dependencies) {
    it(`${name} (${section}) is an exact version, not a range`, () => {
      assert.match(spec, EXACT_VERSION, `${name} is "${spec}"; use an exact x.y.z`);
    });

    it(`${name} matches the version the lockfile resolves`, () => {
      assert.equal(lockfile.packages[`node_modules/${name}`]?.version, spec);
    });
  }
});
