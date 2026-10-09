import assert from "node:assert/strict";
import { format, stripVTControlCharacters } from "node:util";

// Only the deliberate failure operation is silenced. Extra or missing errors
// fail the assertion; errors before or after it still reach the quality gate.
export async function expectConsoleErrors(t, expected, action) {
  const errors = [];
  const mock = t.mock.method(console, "error", (...args) => {
    errors.push(
      stripVTControlCharacters(format(...args))
        .trim()
        .replace(/^✘\s*\[ERROR\]\s*/u, ""),
    );
  });
  try {
    const result = await action();
    assert.deepEqual(
      errors,
      typeof expected === "function" ? expected(result) : expected,
      "Deliberate failure logs must match",
    );
    return result;
  } finally {
    mock.mock.restore();
  }
}
