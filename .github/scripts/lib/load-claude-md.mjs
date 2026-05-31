import { readFileSync } from 'node:fs';

/**
 * Load the project quality standard (CLAUDE.md) so Claude applies it when
 * evaluating review findings. Also pushes the combined system prompt above the
 * 2,048-token prompt-caching minimum for claude-sonnet-4-6, making the cache
 * markers actually effective. Returns null if the file cannot be read —
 * caching degrades silently in that case, which is safe.
 *
 * @param {string} filePath  Path to CLAUDE.md, relative to CWD.
 * @returns {string|null}
 */
export function loadClaudeMd(filePath) {
  try {
    const content = readFileSync(filePath, 'utf8').trim();
    console.log(`Loaded CLAUDE.md (${content.length} chars) from ${filePath}`);
    return content;
  } catch (err) {
    console.warn(
      `Could not load CLAUDE.md from ${filePath} — cache prefix degraded, quality-standard block skipped (${err.code ?? err.message})`
    );
    return null;
  }
}
