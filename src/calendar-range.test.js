import assert from "node:assert/strict";
import test from "node:test";
import { monthRange } from "./calendar-range.js";

test("calendar range covers whole weeks around the current month", () => {
  const { start, end } = monthRange(new Date(2026, 10, 15));
  const first = new Date(2026, 10, 1);
  const last = new Date(2026, 11, 0);

  assert.equal(start.getDay(), 1);
  assert.equal(end.getDay(), 0);
  assert.ok(start <= first);
  assert.ok(end >= last);
  assert.equal(Math.round((end - start) / 864e5) + 1, 42);
});
