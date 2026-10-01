/**
 * @file config.test.mjs
 * Covers src/js/00-config.js — app configuration defaults and runtime setters.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

let configMod;

async function loadMod() {
  if (!configMod) {
    if (!globalThis.localStorage) {
      const store = {};
      globalThis.localStorage = {
        getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
        setItem: (k, v) => {
          store[k] = String(v);
        },
        removeItem: (k) => {
          delete store[k];
        },
      };
    }
    configMod = await import('../../src/js/00-config.js');
  }
  return configMod;
}

// ---------------------------------------------------------------------------

describe('00-config — exported defaults', () => {
  it('WEATHER_LAT is a number', async () => {
    const { WEATHER_LAT } = await loadMod();
    assert.equal(typeof WEATHER_LAT, 'number');
  });

  it('WEATHER_LON is a number', async () => {
    const { WEATHER_LON } = await loadMod();
    assert.equal(typeof WEATHER_LON, 'number');
  });

  it('WEATHER_NAME is a non-empty string', async () => {
    const { WEATHER_NAME } = await loadMod();
    assert.equal(typeof WEATHER_NAME, 'string');
    assert.ok(WEATHER_NAME.length > 0);
  });

  it('JIRA_BASE is a string', async () => {
    const { JIRA_BASE } = await loadMod();
    assert.equal(typeof JIRA_BASE, 'string');
  });

  it('CAL_ACCOUNT_LABELS is an object', async () => {
    const { CAL_ACCOUNT_LABELS } = await loadMod();
    assert.equal(typeof CAL_ACCOUNT_LABELS, 'object');
    assert.ok(CAL_ACCOUNT_LABELS !== null);
  });

  it('AUTO_PAUSE_ON_TAB_SWITCH is a boolean', async () => {
    const { AUTO_PAUSE_ON_TAB_SWITCH } = await loadMod();
    assert.equal(typeof AUTO_PAUSE_ON_TAB_SWITCH, 'boolean');
  });

  it('GOFORE_SUBMIT_ENABLED is a boolean', async () => {
    const { GOFORE_SUBMIT_ENABLED } = await loadMod();
    assert.equal(typeof GOFORE_SUBMIT_ENABLED, 'boolean');
  });
});

describe('00-config — setWeatherConfig', () => {
  let origLat, origLon, origName;

  before(async () => {
    const mod = await loadMod();
    origLat = mod.WEATHER_LAT;
    origLon = mod.WEATHER_LON;
    origName = mod.WEATHER_NAME;
  });

  after(async () => {
    // Restore originals so other tests in the file are unaffected
    const { setWeatherConfig } = await loadMod();
    setWeatherConfig(origLat, origLon, origName);
  });

  it('updates all three values when all are valid', async () => {
    const mod = await loadMod();
    mod.setWeatherConfig(51.5074, -0.1278, 'London');
    assert.equal(mod.WEATHER_LAT, 51.5074);
    assert.equal(mod.WEATHER_LON, -0.1278);
    assert.equal(mod.WEATHER_NAME, 'London');
  });

  it('leaves lat/lon unchanged when passed undefined (missing from server)', async () => {
    const mod = await loadMod();
    mod.setWeatherConfig(51.5074, -0.1278, 'London'); // set known state
    mod.setWeatherConfig(undefined, undefined, 'Paris');
    assert.equal(mod.WEATHER_LAT, 51.5074, 'lat should be unchanged');
    assert.equal(mod.WEATHER_LON, -0.1278, 'lon should be unchanged');
    assert.equal(mod.WEATHER_NAME, 'Paris');
  });

  it('leaves name unchanged when passed an empty string', async () => {
    const mod = await loadMod();
    mod.setWeatherConfig(48.8566, 2.3522, 'Paris');
    mod.setWeatherConfig(undefined, undefined, '');
    assert.equal(mod.WEATHER_NAME, 'Paris', 'name should be unchanged');
  });

  it('ignores non-numeric lat/lon', async () => {
    const mod = await loadMod();
    mod.setWeatherConfig(48.8566, 2.3522, 'Paris');
    mod.setWeatherConfig('bad', NaN, 'Berlin');
    assert.equal(mod.WEATHER_LAT, 48.8566, 'lat should be unchanged for non-number');
    assert.equal(mod.WEATHER_LON, 2.3522, 'lon should be unchanged for NaN');
    assert.equal(mod.WEATHER_NAME, 'Berlin');
  });
});

describe('00-config — setJiraBase', () => {
  let origBase;

  before(async () => {
    const mod = await loadMod();
    origBase = mod.JIRA_BASE;
  });

  after(async () => {
    const { setJiraBase } = await loadMod();
    setJiraBase(origBase);
  });

  it('updates JIRA_BASE to the supplied URL', async () => {
    const mod = await loadMod();
    mod.setJiraBase('https://acme.atlassian.net/browse');
    assert.equal(mod.JIRA_BASE, 'https://acme.atlassian.net/browse');
  });

  it('allows clearing JIRA_BASE to an empty string', async () => {
    const mod = await loadMod();
    mod.setJiraBase('');
    assert.equal(mod.JIRA_BASE, '');
  });
});
