// Unit tests for username validation and normalization (the live availability check's shape gate).
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateUsername, normalizeUsername, isValidUsername } from "./username.js";

test("accepts a simple lowercase handle", () => {
  const v = validateUsername("malena");
  assert.equal(v.ok, true);
  assert.equal(v.normalized, "malena");
  assert.equal(v.error, undefined);
});

test("accepts digits and single internal underscores", () => {
  assert.equal(isValidUsername("la_otra_llave_20"), true);
  assert.equal(isValidUsername("user123"), true);
  assert.equal(isValidUsername("a1b"), true);
});

test("normalizes by trimming and lowercasing", () => {
  assert.equal(normalizeUsername("  Malena  "), "malena");
  const v = validateUsername("  MaLeNa ");
  assert.equal(v.ok, true);
  assert.equal(v.normalized, "malena");
});

test("rejects empty and whitespace-only", () => {
  assert.equal(validateUsername("").error, "empty");
  assert.equal(validateUsername("   ").error, "empty");
  assert.equal(validateUsername(undefined).error, "empty");
  assert.equal(validateUsername(42).error, "empty");
});

test("rejects too short and too long", () => {
  assert.equal(validateUsername("ab").error, "too_short");
  assert.equal(validateUsername("a".repeat(31)).error, "too_long");
  assert.equal(validateUsername("a".repeat(30)).ok, true);
  assert.equal(validateUsername("abc").ok, true);
});

test("rejects leading/trailing/double underscores and bad chars", () => {
  assert.equal(validateUsername("_malena").error, "invalid_chars");
  assert.equal(validateUsername("malena_").error, "invalid_chars");
  assert.equal(validateUsername("ma__lena").error, "invalid_chars");
  assert.equal(validateUsername("ma lena").error, "invalid_chars");
  assert.equal(validateUsername("ma-lena").error, "invalid_chars");
  assert.equal(validateUsername("maléna").error, "invalid_chars");
});
