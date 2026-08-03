#!/usr/bin/env node
/**
 * CLI wrapper around extractChangelogSection() for use from release.yml.
 *
 * Usage: node .github/scripts/render-release-notes.mjs <tag> > release-notes.md
 *
 * <tag> is the pushed git tag (e.g. "v1.9.1"); its leading "v" is stripped
 * before matching against CHANGELOG.md's "## [X.Y.Z] — <date>" headings.
 * The decision logic itself is unit-tested in
 * test/extract-changelog-section.test.mjs; this file is a thin, untested
 * I/O shim, same convention as the rest of .github/scripts/.
 */

import { readFileSync } from 'fs';
import { extractChangelogSection } from './lib/extract-changelog-section.mjs';

const tag = process.argv[2];
if (!tag) {
  console.error('Usage: render-release-notes.mjs <tag>');
  process.exit(1);
}

const version = tag.replace(/^v/, '');
const changelog = readFileSync('CHANGELOG.md', 'utf8');
const section = extractChangelogSection(changelog, version);

process.stdout.write(section ? `${section}\n` : '');
