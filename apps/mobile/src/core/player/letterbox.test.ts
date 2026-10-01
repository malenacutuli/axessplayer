import { test } from "node:test";
import assert from "node:assert/strict";
import { aspectOf, fitContain, inlineStageHeight } from "./letterbox";

const phone = { width: 390, height: 844 };

test("vertical 9:16 on a tall phone: thin letterbox top and bottom", () => {
  const r = fitContain(phone, 9 / 16);
  assert.equal(r.bars, "letterbox");
  assert.equal(r.width, 390);
  assert.ok(Math.abs(r.height - 693.33) < 0.01);
  assert.ok(Math.abs(r.offsetY - (844 - r.height) / 2) < 1e-9);
});

test("horizontal 16:9 on a portrait phone: letterboxed band", () => {
  const r = fitContain(phone, 16 / 9);
  assert.equal(r.bars, "letterbox");
  assert.ok(Math.abs(r.height - 219.375) < 1e-9);
});

test("vertical on a landscape screen: pillarbox", () => {
  const r = fitContain({ width: 844, height: 390 }, 9 / 16);
  assert.equal(r.bars, "pillarbox");
  assert.ok(Math.abs(r.width - 219.375) < 1e-9);
  assert.ok(Math.abs(r.offsetX - (844 - 219.375) / 2) < 1e-9);
});

test("square and exact fits", () => {
  assert.equal(fitContain({ width: 400, height: 400 }, 1).bars, "none");
  assert.equal(fitContain({ width: 1600, height: 900 }, 16 / 9).bars, "none");
  assert.equal(fitContain({ width: 0, height: 100 }, 1).width, 0);
  assert.equal(fitContain({ width: 100, height: 100 }, NaN).bars, "none");
});

test("aspectOf prefers real dimensions, falls back to orientation", () => {
  assert.equal(aspectOf({ orientation: "vertical", width: 1000, height: 500 }), 2);
  assert.equal(aspectOf({ orientation: "vertical", width: null, height: null }), 9 / 16);
  assert.equal(aspectOf({ orientation: "square", width: 0, height: 0 }), 1);
});

test("inline stage height caps tall videos", () => {
  assert.ok(Math.abs(inlineStageHeight(phone, 16 / 9) - 219.375) < 1e-9);
  assert.equal(inlineStageHeight(phone, 9 / 16), 844 * 0.7);
});
