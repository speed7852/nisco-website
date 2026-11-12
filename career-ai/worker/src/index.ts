export interface Env {
  APP_NAME: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const headers = {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
    };

    if (url.pathname === "/health") {
      return new Response(JSON.stringify({
        ok: true,
        service: env.APP_NAME || "NISCO Career AI",
        phase: "deployment-scaffold",
      }), { headers });
    }

    return new Response(JSON.stringify({
      ok: false,
      error: "not_implemented",
      message: "Career AI API is not yet enabled. Complete authentication and data services before use.",
    }), { status: 501, headers });
  },
};
