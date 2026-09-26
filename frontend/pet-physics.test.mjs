import { test } from "node:test";
import assert from "node:assert/strict";
import { advanceMotion } from "./electron/pet-physics.mjs";

const area = { x: -1920, y: 40, width: 1920, height: 1040 };
const box = { x: 10, y: 14, width: 180, height: 192 };
const left = area.x - box.x, right = area.x + area.width - box.x - box.width;
const top = area.y - box.y, bottom = area.y + area.height - box.y - box.height;
for (const [wall, x, y, vx, vy, hitX, hitY] of [
  ["left", left, 300, -54, 28, true, false],
  ["right", right, 300, 54, 28, true, false],
  ["top", -1000, top, 54, -28, false, true],
  ["bottom", -1000, bottom, 54, 28, false, true],
  ["corner", right, bottom, 54, 28, true, true]
]) {
  test("reflects only the crossed axes at " + wall + " on a negative-coordinate display", () => {
    const next = advanceMotion({ x, y, vx, vy }, area, box, .1);
    assert(next.x >= left && next.x <= right && next.y >= top && next.y <= bottom);
    assert.equal(next.hitX, hitX); assert.equal(next.hitY, hitY);
    assert.equal(next.vx, hitX ? -vx : vx); assert.equal(next.vy, hitY ? -vy : vy);
  });
}
test("fractional movement accumulates independently of tick frequency", () => {
  const start = { x: -1000, y: 300, vx: 54, vy: 28 };
  let many = start;
  for (let i = 0; i < 100; i++) many = advanceMotion(many, area, box, .01);
  const one = advanceMotion(start, area, box, 1);
  assert(Math.abs(many.x - one.x) < .0001 && Math.abs(many.y - one.y) < .0001);
});
test("dragging far outside a work area clamps to the visible artwork bounds", () => {
  const next = advanceMotion({ x: -99999, y: 99999, vx: 0, vy: 0 }, area, box, 0);
  assert.equal(next.x, left); assert.equal(next.y, bottom);
});
test("overshoot reflects distance without losing speed", () => {
  const next = advanceMotion({ x: right - 1, y: top + 1, vx: 54, vy: -28 }, area, box, 1);
  assert.equal(next.x, right - 53); assert.equal(next.y, top + 27);
  assert.equal(next.vx, -54); assert.equal(next.vy, 28);
});
test("a display smaller than the pet produces finite stationary coordinates", () => {
  const next = advanceMotion({ x: 500, y: 500, vx: 54, vy: 28 }, { x: 0, y: 0, width: 90, height: 90 }, box, .1);
  assert(Number.isFinite(next.x) && Number.isFinite(next.y));
  assert.equal(next.vx, 0); assert.equal(next.vy, 0);
});
