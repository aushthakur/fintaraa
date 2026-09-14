import test from "node:test";
import assert from "node:assert/strict";
import { getKeepAliveTargetUrls, getKeepAliveStatus } from "../services/keepAlive.service";

test("getKeepAliveTargetUrls returns configured targets or default targets", () => {
  const targets = getKeepAliveTargetUrls();
  assert.ok(Array.isArray(targets), "Targets should be an array");
  assert.ok(targets.length > 0, "Should have at least one target URL");
  for (const target of targets) {
    assert.match(target, /^https?:\/\//, `Target ${target} should be a valid HTTP/HTTPS URL`);
  }
});

test("getKeepAliveStatus returns proper initial structure and 3-minute interval", () => {
  const status = getKeepAliveStatus();
  assert.strictEqual(status.intervalMinutes, 3, "Interval should be exactly 3 minutes");
  assert.strictEqual(status.intervalMs, 180000, "Interval ms should be 180,000 ms");
  assert.ok(Array.isArray(status.targets), "Status should include target URLs");
  assert.ok(Array.isArray(status.lastResults), "Status should include results array");
});
