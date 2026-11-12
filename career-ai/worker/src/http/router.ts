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

interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  handler: Handler;
  auth: boolean;
}

export type RouteMatch =
  | { kind: "found"; route: { handler: Handler; auth: boolean }; params: Record<string, string> }
  | { kind: "method_not_allowed"; allow: string[] }
  | { kind: "not_found" };

/** Minimal method + path router. Paths use `:name` segments, e.g. `/api/jobs/:id/match`. */
export class Router {
  private readonly routes: Route[] = [];

  add(method: string, path: string, handler: Handler, options: { auth: boolean }): this {
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
    this.routes.push({ method, pattern: new RegExp(`^${source}$`), keys, handler, auth: options.auth });
    return this;
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
      return { kind: "found", route: { handler: route.handler, auth: route.auth }, params };
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
