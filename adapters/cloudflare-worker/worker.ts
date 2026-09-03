/**
 * formflow Cloudflare Worker adapter — TEMPLATE. Copy into your own
 * project and fill in buildSchema()/persistAnswer()/persistAddition() for
 * your own D1 schema. This file is deliberately generic; see
 * pss-student-download/src/worker.v2.ts for a real, filled-in example.
 */

export interface Env {
  DB: D1Database;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

/** Fill this in: look up `token`, return a formflow schema or null if not found. */
async function buildSchema(env: Env, token: string): Promise<{ title: string; steps: unknown[] } | null> {
  throw new Error("buildSchema() not implemented -- see adapters/cloudflare-worker/README.md");
}

/** Fill this in: persist one "choice"/"text" step answer for this token. */
async function persistAnswer(env: Env, token: string, stepId: string, value: unknown, note: string): Promise<boolean> {
  throw new Error("persistAnswer() not implemented");
}

/** Fill this in: persist one repeat-group entry for this token. Omit if your schema has no repeat-group step. */
async function persistAddition(env: Env, token: string, entry: Record<string, string>): Promise<boolean> {
  throw new Error("persistAddition() not implemented");
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    const schemaMatch = url.pathname.match(/^\/survey\/([^/]+)$/);
    if (request.method === "GET" && schemaMatch) {
      const schema = await buildSchema(env, schemaMatch[1]);
      return schema ? json(schema) : json({ error: "not_found" }, 404);
    }

    const answerMatch = url.pathname.match(/^\/survey\/([^/]+)\/answer$/);
    if (request.method === "POST" && answerMatch) {
      const body = await request.json<{ stepId?: string; value?: unknown; note?: string }>();
      if (!body.stepId || body.value === undefined) return json({ error: "missing_fields" }, 400);
      const ok = await persistAnswer(env, answerMatch[1], body.stepId, body.value, body.note || "");
      return ok ? json({ ok: true }) : json({ error: "not_found" }, 404);
    }

    const additionMatch = url.pathname.match(/^\/survey\/([^/]+)\/addition$/);
    if (request.method === "POST" && additionMatch) {
      const entry = await request.json<Record<string, string>>();
      const ok = await persistAddition(env, additionMatch[1], entry);
      return ok ? json({ ok: true }) : json({ error: "not_found" }, 404);
    }

    return json({ error: "not_found" }, 404);
  },
};
