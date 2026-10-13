import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fitTrackerBox, fitTrackerDockWidth, isTrackerDockTarget, trackerDockTarget } from '../web/src/lib/tracker-window.ts';

test('saved desktop position fits a phone without hiding the footer', () => {
  const b = fitTrackerBox({ x: 1400, y: 700, w: 900, h: 800 }, 390, 700);
  assert.ok(b.x >= 8 && b.x + b.w <= 382);
  assert.ok(b.y >= 8 && b.y + b.h <= 644);
  assert.equal(b.w, 374);
});
test('dragging beyond the page keeps the controls reachable', () => {
  const b = fitTrackerBox({ x: -999, y: -999, w: 200, h: 100 }, 1440, 900);
  assert.deepEqual(b, { x: 8, y: 8, w: 400, h: 300 });
});
test('corrupt saved numbers recover to a usable window', () => {
  const b = fitTrackerBox({ x: NaN, y: Infinity, w: NaN, h: -Infinity }, 1440, 900);
  assert.ok(Object.values(b).every(Number.isFinite));
  assert.ok(b.w >= 400 && b.h >= 300);
  assert.deepEqual(fitTrackerBox(b, 1440, 900), b);
  assert.ok(Object.values(fitTrackerBox(null, 390, 700)).every(Number.isFinite));
});

test('docking preserves usable page width and ignores mobile edge drags', () => {
  assert.equal(isTrackerDockTarget(1400, 1440), true);
  assert.equal(isTrackerDockTarget(1300, 1440), false);
  assert.equal(isTrackerDockTarget(389, 390), false);
  assert.equal(fitTrackerDockWidth(NaN, 1300), 440);
  assert.equal(fitTrackerDockWidth(900, 900), 460);
  assert.equal(fitTrackerDockWidth(100, 1300), 360);
});

test('either workspace edge accepts docking, with the rail outside the left edge', () => {
  assert.equal(trackerDockTarget(220, 1440, 208), 'left');
  assert.equal(trackerDockTarget(10, 1440, 208), 'left');
  assert.equal(trackerDockTarget(1400, 1440, 208), 'right');
  assert.equal(trackerDockTarget(600, 1440, 208), null);
  assert.equal(trackerDockTarget(5, 390), null);
  assert.equal(trackerDockTarget(NaN, 1440), null);
});
