import assert from "node:assert/strict";
import { test } from "node:test";
import {
  closeBrowserServer,
  runBrowserCheck,
} from "../scripts/layout-browser.mjs";

test("a navigation error survives stalled WebKit context cleanup", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const navigationError = new Error("page.goto: Timeout 30000ms exceeded");
  const closing = Promise.withResolvers();
  const check = runBrowserCheck({
    label: "mobile-safari-webkit /slides/ iphone-se (320x740)",
    run: async () => {
      throw navigationError;
    },
    close: () => {
      closing.resolve();
      return new Promise(() => {});
    },
    cleanupTimeoutMs: 5,
  });
  const rejected = assert.rejects(check, (error) => {
    assert.match(error.message, /\/slides\/ iphone-se \(320x740\)/);
    assert.ok(error.cause instanceof AggregateError);
    assert.equal(error.cause.errors[0], navigationError);
    assert.match(error.cause.errors[1].message, /cleanup timed out/);
    return true;
  });

  await closing.promise;
  t.mock.timers.tick(5);
  await rejected;
});

test("a stalled layout evaluation times out and still closes its context", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const started = Promise.withResolvers();
  let closed = false;
  const check = runBrowserCheck({
    label: "mobile-safari-webkit /slides/ iphone-15",
    run: () => {
      started.resolve();
      return new Promise(() => {});
    },
    close: () => {
      closed = true;
    },
    timeoutMs: 10,
  });
  const rejected = assert.rejects(
    check,
    /\/slides\/ iphone-15: Layout check timed out/,
  );

  await started.promise;
  t.mock.timers.tick(10);
  await rejected;
  assert.equal(closed, true);
});

test("stalled graceful shutdown kills the validation-owned browser", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const calls = [];
  const browserServer = {
    close: () => {
      calls.push("close");
      return new Promise(() => {});
    },
    kill: async () => {
      calls.push("kill");
    },
  };

  const closing = closeBrowserServer(browserServer, 5);
  t.mock.timers.tick(5);
  await closing;
  assert.deepEqual(calls, ["close", "kill"]);
});
