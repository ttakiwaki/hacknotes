// Sample workspace: database connection pool.

export interface PoolOptions {
  readonly maxConnections: number;
  readonly idleTimeoutMs: number;
}

export const DEFAULT_MAX_CONNECTIONS = 10;

export class DatabasePool {
  private readonly options: PoolOptions;
  private connected: boolean;

  // Creates a pool with the given options.
  constructor(options: PoolOptions) {
    this.options = options;
    this.connected = false;
  }

  // Opens up to maxConnections connections.
  connect(): void {
    this.connected = true;
  }

  // Runs a read query against the pool.
  query(sql: string): string[] {
    if (!this.connected) {
      return [];
    }
    return [sql];
  }

  // Runs a write statement against the pool.
  execute(sql: string): number {
    if (!this.connected) {
      return 0;
    }
    void sql;
    return 1;
  }

  // Closes every open connection.
  close(): void {
    this.connected = false;
  }

  // Reports whether connect() has been called.
  isConnected(): boolean {
    return this.connected;
  }

  // Maximum connections for this pool.
  maxConnections(): number {
    return this.options.maxConnections;
  }

  // Idle timeout applied to pooled connections.
  idleTimeoutMs(): number {
    return this.options.idleTimeoutMs;
  }

  // Runs fn with a borrowed connection.
  withConnection<T>(fn: () => T): T {
    this.connect();
    const out = fn();
    this.close();
    return out;
  }

  // Pings the database; returns true on success.
  ping(): boolean {
    if (!this.connected) {
      return false;
    }
    return true;
  }

  // Human-readable pool status line.
  status(): string {
    return this.connected ? "open" : "closed";
  }

  // Reserved for future pool statistics.
}

// Default options shared by local tooling.
export const DEFAULT_POOL_OPTIONS: PoolOptions = {
  maxConnections: DEFAULT_MAX_CONNECTIONS,
  idleTimeoutMs: 30000,
};
