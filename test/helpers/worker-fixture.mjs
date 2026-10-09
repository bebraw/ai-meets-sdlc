import { createTestHarness, unstable_splitSqlQuery } from "wrangler";

// test:prepare compiles once before Node starts its isolated test-file processes.
// Each fixture still owns a fresh runtime and all of its D1/R2/DO storage.
export async function createWorkerFixture({ vars = {} } = {}) {
  const server = createTestHarness({
    workers: [
      {
        configPath: "wrangler.jsonc",
        prebuiltWorkerDir: ".cache/test-worker",
        vars,
        secrets: vars,
      },
    ],
  });
  const responses = new Set();
  const flushLogs = () => {
    for (const { level, message } of server.getLogs()) {
      if (level === "error") console.error(message);
      else if (level === "warn") console.warn(message);
      else console.log(message);
    }
    server.clearLogs();
  };
  const dispose = async () => {
    try {
      // Status-only assertions leave response streams unread. Cancel them so
      // harness shutdown does not wait for the HTTP keep-alive timeout.
      await Promise.all(
        [...responses]
          .filter(
            (response) =>
              response.body && !response.bodyUsed && !response.body.locked,
          )
          .map((response) => response.body.cancel()),
      );
    } finally {
      try {
        await server.close();
      } finally {
        flushLogs();
      }
    }
  };
  try {
    const { url } = await server.listen();
    const handle = server.getWorker();
    await handle.applyD1Migrations("INTERESTS");
    const env = await handle.getEnv();
    return {
      worker: {
        async fetch(input, init) {
          try {
            const response = await server.fetch(input, init);
            responses.add(response);
            return response;
          } finally {
            flushLogs();
          }
        },
        address: url.hostname,
        port: Number(url.port),
        stop: dispose,
      },
      env,
      async runSql(sql) {
        const statements = unstable_splitSqlQuery(sql).map((query) =>
          env.INTERESTS.prepare(query),
        );
        const results = await env.INTERESTS.batch(statements);
        return results[0].results;
      },
      dispose,
    };
  } catch (error) {
    await dispose();
    throw error;
  }
}
