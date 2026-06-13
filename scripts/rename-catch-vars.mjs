/**
 * Renames single-letter catch-block error variables (e) to descriptive names
 * (err) across all src/js/*.js source files. Only modifies the catch parameter
 * and references inside the catch body — filter/map arrow-function parameters
 * are left untouched.
 *
 * Strategy: process line-by-line, tracking brace depth scoped to the catch
 * body (braces on the catch-open line are counted only from the opening `{`
 * of the catch body onward, ignoring the preceding `}` that closes the try).
 */

import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join } from 'path';

const SRC_DIR = join(import.meta.dirname, '..', 'src', 'js');

const CATCH_E_RE = /\bcatch\s*\(\s*e\s*\)/;

/** Count `{` and `}` in a string. */
function countBraces(str) {
  return { opens: (str.match(/\{/g) || []).length, closes: (str.match(/\}/g) || []).length };
}

/**
 * Rename all error-variable `e` references within a catch body line.
 * Only targets patterns that are unambiguous error-variable uses:
 * property access (e.message, e.name, e.stack, e.code, e.cause),
 * trailing argument (`, e)` or `, e,`), and throw re-raise (`throw e`).
 */
function renameCatchBodyE(line) {
  return line
    .replace(/\be\.message\b/g, 'err.message')
    .replace(/\be\.name\b/g, 'err.name')
    .replace(/\be\.stack\b/g, 'err.stack')
    .replace(/\be\.code\b/g, 'err.code')
    .replace(/\be\.cause\b/g, 'err.cause')
    .replace(/(,\s*)e(\s*[),])/g, '$1err$2')
    .replace(/\bthrow\s+e\b/g, 'throw err');
}

/** Process one file; return [newContent, changeCount]. */
function processFile(filePath) {
  const lines = readFileSync(filePath, 'utf8').split('\n');
  let inCatchBody = false;
  let catchBraceDepth = 0;
  let changes = 0;

  const result = lines.map((line) => {
    if (CATCH_E_RE.test(line)) {
      // Rename the catch parameter
      let renamed = line.replace(CATCH_E_RE, 'catch (err)');
      if (renamed !== line) changes++;

      // Start tracking catch-body scope: count only braces AFTER the `catch (...)`
      const afterCatch = renamed.slice(renamed.indexOf('catch (err)') + 'catch (err)'.length);
      const { opens, closes } = countBraces(afterCatch);
      catchBraceDepth = opens - closes;
      inCatchBody = catchBraceDepth > 0;

      // Also rename any body content on the same line as the catch
      if (inCatchBody || catchBraceDepth === 0) {
        const bodyPart = renameCatchBodyE(afterCatch);
        if (bodyPart !== afterCatch) {
          changes++;
          renamed = renamed.slice(0, renamed.indexOf('catch (err)') + 'catch (err)'.length) + bodyPart;
        }
      }
      return renamed;
    }

    if (inCatchBody) {
      const renamed = renameCatchBodyE(line);
      if (renamed !== line) changes++;

      const { opens, closes } = countBraces(line);
      catchBraceDepth += opens - closes;
      if (catchBraceDepth <= 0) {
        inCatchBody = false;
        catchBraceDepth = 0;
      }
      return renamed;
    }

    return line;
  });

  return [result.join('\n'), changes];
}

const jsFiles = readdirSync(SRC_DIR)
  .filter((f) => f.endsWith('.js'))
  .map((f) => join(SRC_DIR, f));

let totalChanges = 0;
for (const file of jsFiles) {
  const [newContent, changes] = processFile(file);
  if (changes > 0) {
    writeFileSync(file, newContent, 'utf8');
    console.log(`  ${changes} change(s): ${file.split(/[\\/]/).at(-1)}`);
    totalChanges += changes;
  }
}
console.log(`\nTotal: ${totalChanges} rename(s) across ${jsFiles.length} files.`);
