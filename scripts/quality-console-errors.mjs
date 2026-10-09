import { format } from "node:util";

// Inherit this preload in every Node process launched by the quality gate.
// Plain console.error calls must be as visible to the gate as Wrangler errors.
const error = console.error.bind(console);
console.error = (...args) => error(`[ERROR] ${format(...args)}`);
