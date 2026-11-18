import { config, ConfigError } from "./config.mts";

/** CORS headers for an allowed storefront origin (none for others, so browsers block them). */
function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("origin")?.replace(/\/$/, "");
  if (!origin || !config.allowedOrigins.includes(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Accept, Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

export function json(request: Request, data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex",
      ...corsHeaders(request),
    },
  });
}

export function fail(request: Request, status: number, error: string, message: string): Response {
  return json(request, { ok: false, error, message }, status);
}

/** Answers CORS preflight requests, logs unexpected errors and returns JSON for them. */
export function handler(run: (request: Request) => Promise<Response>) {
  return async (request: Request): Promise<Response> => {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(request) });
    try {
      return await run(request);
    } catch (error) {
      if (error instanceof ConfigError) {
        console.error(`Configuration error: ${error.message}`);
        return fail(request, 503, "not_configured", "Reviews are temporarily unavailable. Please try again later.");
      }
      console.error(`Error on ${new URL(request.url).pathname}:`, error);
      return fail(request, 500, "server_error", "Something went wrong on our side. Please try again.");
    }
  };
}
