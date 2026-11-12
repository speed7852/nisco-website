import type { AuthContext } from "../auth";
import type { Env } from "../env";

export interface RequestContext {
  request: Request;
  env: Env;
  url: URL;
  params: Record<string, string>;
  /** Present on routes registered with `auth: true` (all /api routes except sign-in). */
  auth: AuthContext | null;
  requestId: string;
}

export type Handler = (ctx: RequestContext) => Promise<Response>;

export interface RouteOptions {
  auth: boolean;
  /** Holds CV or profile data: in Access mode, also requires an explicit owner identity. */
  personal?: boolean;
}

interface Route {
  method: string;
  path: string;
  pattern: RegExp;
  keys: string[];
  handler: Handler;
  auth: boolean;
  personal: boolean;
}

export type RouteMatch =
  | { kind: "found"; route: { handler: Handler; auth: boolean; personal: boolean }; params: Record<string, string> }
  | { kind: "method_not_allowed"; allow: string[] }
  | { kind: "not_found" };

/** Minimal method + path router. Paths use `:name` segments, e.g. `/api/jobs/:id/match`. */
export class Router {
  private readonly routes: Route[] = [];

  add(method: string, path: string, handler: Handler, options: RouteOptions): this {
    const keys: string[] = [];
    const source = path
      .split("/")
      .map((segment) => {
        if (segment.startsWith(":")) {
          keys.push(segment.slice(1));
          return "([^/]+)";
        }
        return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      })
      .join("/");
    this.routes.push({
      method,
      path,
      pattern: new RegExp(`^${source}$`),
      keys,
      handler,
      auth: options.auth,
      personal: options.personal ?? false,
    });
    return this;
  }

  /** Every registered route, for tests that must cover all of them. */
  list(): { method: string; path: string; auth: boolean; personal: boolean }[] {
    return this.routes.map(({ method, path, auth, personal }) => ({ method, path, auth, personal }));
  }

  match(method: string, pathname: string): RouteMatch {
    const allow: string[] = [];
    for (const route of this.routes) {
      const found = route.pattern.exec(pathname);
      if (!found) continue;
      if (route.method !== method) {
        allow.push(route.method);
        continue;
      }
      const params: Record<string, string> = {};
      route.keys.forEach((key, index) => {
        params[key] = decodeURIComponentSafe(found[index + 1] ?? "");
      });
      return { kind: "found", route: { handler: route.handler, auth: route.auth, personal: route.personal }, params };
    }
    return allow.length > 0 ? { kind: "method_not_allowed", allow } : { kind: "not_found" };
  }
}

function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
