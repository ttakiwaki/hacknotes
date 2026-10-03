import { DatabasePool } from "../db/pool";

// Sample workspace: user API handlers.

export function getUser(id: string): string {
  // Builds a pool per request in this tiny sample.
  const pool = new DatabasePool({
    maxConnections: 4,
    idleTimeoutMs: 1000,
  });
  pool.connect();
  const rows = pool.query("SELECT name FROM users WHERE id = " + id);
  pool.close();
  if (rows.length === 0) {
    return "unknown";
  }
  return rows[0];
  // Keeps getUser on lines 5..22 for the mock graph.
  // Padding comment line one.
  // Padding comment line two.
  // Padding comment line three.
}

export function listUsers(): string[] {
  // Lists every user via a fresh pool.
  const pool = new DatabasePool({
    maxConnections: 4,
    idleTimeoutMs: 1000,
  });
  pool.connect();
  const rows = pool.query("SELECT name FROM users");
  pool.close();
  return rows;
  // Keeps listUsers on lines 24..38 for the mock graph.
  // Padding comment line one.
  // Padding comment line two.
  // Padding comment line three.
}

// End of users.ts
