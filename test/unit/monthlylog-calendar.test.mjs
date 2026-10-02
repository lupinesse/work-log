/**
 * @file monthlylog-calendar.test.mjs
 * Covers the split of renderMonthlyCalendar() in 19-monthlylog.js (#500):
 * buildMonthlyCalendarHtml() builds markup only, bindMonthlyCalendarEvents()
 * binds listeners only, and renderMonthlyCalendar() composes the two.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { __dirname, createDom } from './_helpers.mjs';

const monthlySrc = readFileSync(join(__dirname, '../../src/js/19-monthlylog.js'), 'utf8');

const STUBS = `
  var entries = [];
  var getEntries = () => entries;
  var planTasks = [];
  var viewDate = new Date(2026, 0, 1);
  var setViewDate = (date) => { viewDate = date; };
  var navigatedToLog = 0;
  var renderCalls = 0;
  var monthlyLogRenders = 0;
  var render = () => { renderCalls += 1; };
  var setFlowView = (view) => { navigatedToLog += view === 'log' ? 1 : 0; };
  var fmtDur = () => '';
  var escHtml = (text) => String(text);
  var getCatLabel = () => '';
  var isEntryBillable = () => false;
  var wlLog = { warn() {}, info() {}, error() {}, debug() {} };
`;

describe('monthly calendar split (jsdom)', () => {
  let dom;
  let context;
  let calEl;
  const evaluate = (code) => vm.runInContext(code, context);

  beforeEach(() => {
    dom = createDom('<div id="mlCalendar"></div>');
    context = dom.getInternalVMContext();
    vm.runInContext(STUBS, context);
    vm.runInContext(monthlySrc, context);
    // The prev/next handlers re-render the whole view; count that instead of
    // running the real renderMonthlyLog(), which needs the summary/task panels.
    evaluate('renderMonthlyLog = () => { monthlyLogRenders += 1; }');
    calEl = dom.window.document.getElementById('mlCalendar');
  });

  afterEach(() => dom.window.close());

  describe('buildMonthlyCalendarHtml', () => {
    it('renders one cell per day, offset to a Monday start (May 2026 starts on a Friday)', () => {
      const html = evaluate("buildMonthlyCalendarHtml(2026, 4, '2026-05')");
      assert.equal((html.match(/class="ml-cell"/g) ?? []).length, 31);
      assert.equal(
        (html.match(/<div aria-hidden="true"><\/div>/g) ?? []).length,
        4,
        'four blank cells before Fri 1st'
      );
    });

    it('builds each cell date key from the monthPrefix it is given', () => {
      const html = evaluate("buildMonthlyCalendarHtml(2026, 4, '2026-05')");
      assert.ok(html.includes('data-date="2026-05-01"'));
      assert.ok(html.includes('data-date="2026-05-31"'));
    });

    it('does not touch the DOM', () => {
      evaluate("buildMonthlyCalendarHtml(2026, 4, '2026-05')");
      assert.equal(calEl.innerHTML, '');
    });
  });

  describe('renderMonthlyCalendar + bindMonthlyCalendarEvents', () => {
    beforeEach(() =>
      evaluate("renderMonthlyCalendar(document.getElementById('mlCalendar'), 2026, 4, '2026-05')")
    );

    it('writes the markup into the container', () => {
      assert.equal(calEl.querySelectorAll('.ml-cell').length, 31);
    });

    it('navigates to the clicked day and switches to the Log view', () => {
      calEl.querySelector('.ml-cell[data-date="2026-05-10"]').click();
      assert.equal(evaluate('navigatedToLog'), 1);
      assert.equal(evaluate("viewDate.getDate() + '/' + (viewDate.getMonth() + 1)"), '10/5');
      assert.equal(evaluate('renderCalls'), 1);
    });

    it('moves to the next month and re-renders the view', () => {
      evaluate('_mlYear = 2026; _mlMonth = 4;');
      dom.window.document.getElementById('mlNext').click();
      assert.equal(evaluate('_mlMonth'), 5);
      assert.equal(evaluate('monthlyLogRenders'), 1);
    });

    it('rolls December forward into January of the next year', () => {
      evaluate('_mlYear = 2026; _mlMonth = 11;');
      dom.window.document.getElementById('mlNext').click();
      assert.equal(evaluate('_mlYear + "-" + _mlMonth'), '2027-0');
    });

    it('rolls January back into December of the previous year', () => {
      evaluate('_mlYear = 2026; _mlMonth = 0;');
      dom.window.document.getElementById('mlPrev').click();
      assert.equal(evaluate('_mlYear + "-" + _mlMonth'), '2025-11');
    });
  });
});
