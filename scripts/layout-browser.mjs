export async function withDeadline(operation, timeoutMs, message) {
  let timer;

  try {
    return await Promise.race([
      operation,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function runBrowserCheck({
  label,
  run,
  close,
  timeoutMs = 35000,
  cleanupTimeoutMs = 5000,
}) {
  let failure;
  let result;

  try {
    result = await withDeadline(
      Promise.resolve().then(run),
      timeoutMs,
      "Layout check timed out",
    );
  } catch (error) {
    failure = error;
  }

  try {
    await withDeadline(
      Promise.resolve().then(close),
      cleanupTimeoutMs,
      "Browser context cleanup timed out",
    );
  } catch (error) {
    failure = failure
      ? new AggregateError([failure, error], "Check and cleanup both failed")
      : error;
  }

  if (failure) {
    throw new Error(`${label}: ${failure.message}`, { cause: failure });
  }

  return result;
}

export async function closeBrowserServer(browserServer, timeoutMs = 5000) {
  try {
    await withDeadline(
      browserServer.close(),
      timeoutMs,
      "Browser shutdown timed out",
    );
  } catch {
    // A stalled renderer can prevent graceful context/browser shutdown.
    // Kill only the browser process owned by this validation run.
    await browserServer.kill();
  }
}
