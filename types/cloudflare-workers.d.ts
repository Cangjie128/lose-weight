declare module "cloudflare:workers" {
  export const env: {
    DB?: D1Database;
  };
}

interface Fetcher {
  fetch(request: Request): Promise<Response>;
}

interface D1Database {
  prepare(query: string): {
    bind(...values: unknown[]): unknown;
    run(): Promise<unknown>;
    all(): Promise<unknown>;
    first(): Promise<unknown>;
  };
  batch(statements: unknown[]): Promise<unknown[]>;
}
