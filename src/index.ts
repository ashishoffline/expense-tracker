import { Hono, type Context } from "hono";
import type { Env } from "./types";
import { renderDashboardHtml, renderAccessDeniedHtml } from "./routes/dashboard";
import {
  captureTransaction,
  reprocessTransactions,
  updateTransaction,
} from "./services/transaction.service";

const app = new Hono<{ Bindings: Env }>();

/**
 * Unified Authentication Validator:
 * - Checks `Authorization: Bearer <INGESTION_TOKEN>` (used by iOS Shortcuts and scripts)
 * - Checks `?apiKey=<INGESTION_TOKEN>` query param (used by browser bookmarks)
 * - Checks `auth_token=<INGESTION_TOKEN>` cookie (automatically set during browser session)
 */
function isAuthorized(c: Context<{ Bindings: Env }>): boolean {
  const expectedToken = c.env.INGESTION_TOKEN;
  if (!expectedToken) return false;

  // 1. Authorization header (Bearer token)
  const authHeader = c.req.header("Authorization");
  if (authHeader && authHeader === `Bearer ${expectedToken}`) {
    return true;
  }

  // 2. Query parameter (?apiKey=...)
  const apiKey = c.req.query("apiKey");
  if (apiKey && apiKey === expectedToken) {
    // Automatically set the session cookie whenever a valid apiKey is supplied
    c.header(
      "Set-Cookie",
      `auth_token=${expectedToken}; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax`
    );
    return true;
  }

  // 3. Cookie (auth_token=...)
  const cookie = c.req.header("Cookie");
  if (cookie && cookie.includes(`auth_token=${expectedToken}`)) {
    return true;
  }

  return false;
}

// 1. Dashboard UI (GET / - Protected)
app.get("/", async (c) => {
  if (!isAuthorized(c)) {
    return c.html(renderAccessDeniedHtml(), 401);
  }

  return renderDashboardHtml(c);
});

// 2. Ingestion Webhook (POST /capture for iOS Shortcuts - Protected)
app.post("/capture", async (c) => {
  if (!isAuthorized(c)) {
    return c.json({ success: false, error: "Unauthorized" }, 401);
  }

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: "Invalid JSON payload" }, 400);
  }

  if (!body?.sender || typeof body.sender !== "string" || !body.sender.trim()) {
    return c.json({ success: false, error: "Field 'sender' is required" }, 400);
  }
  if (!body?.message || typeof body.message !== "string" || !body.message.trim()) {
    return c.json({ success: false, error: "Field 'message' is required" }, 400);
  }

  const result = await captureTransaction(c.env.DB, {
    sender: body.sender.trim(),
    message: body.message.trim(),
    source: typeof body.source === "string" ? body.source.trim() : undefined,
    receivedAt: typeof body.receivedAt === "string" ? body.receivedAt.trim() : undefined,
  });
  return c.json(result.data, result.status);
});

// 3. Maintenance Reprocess (POST /reprocess - Protected)
app.post("/reprocess", async (c) => {
  if (!isAuthorized(c)) {
    return c.json({ success: false, error: "Unauthorized" }, 401);
  }

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: "Invalid JSON body. Expected { ids: string[] }" }, 400);
  }

  if (!body?.ids || !Array.isArray(body.ids)) {
    return c.json({
      success: false,
      error: "Field 'ids' must be an array of message IDs",
    }, 400);
  }

  const stringIds = body.ids
    .filter((id: unknown): id is string => typeof id === "string")
    .map((id: string) => id.trim())
    .filter((id: string) => id.length > 0);
  const cleanIds = Array.from(new Set<string>(stringIds));

  if (cleanIds.length === 0 || cleanIds.length > 5) {
    return c.json({
      success: false,
      error: "Must provide between 1 and 5 unique message IDs to reprocess",
    }, 400);
  }

  const result = await reprocessTransactions(c.env.DB, cleanIds);
  return c.json(result);
});

// 4. Update Transaction (PATCH /transactions/:id - Protected)
app.patch("/transactions/:id", async (c) => {
  if (!isAuthorized(c)) {
    return c.json({ success: false, error: "Unauthorized" }, 401);
  }

  const id = c.req.param("id");
  if (!id) {
    return c.json({ success: false, error: "Missing transaction id" }, 400);
  }

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: "Invalid JSON body" }, 400);
  }

  const result = await updateTransaction(c.env.DB, id, body);
  return c.json(result, result.success ? 200 : 400);
});

// 5. Health Check (Public)
app.get("/health", async (c) => {
  try {
    const result = await c.env.DB.prepare("SELECT 1 as connected").first<{ connected: number }>();
    return c.json({
      status: "ok",
      database: result?.connected === 1 ? "connected" : "unknown",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return c.json(
      {
        status: "error",
        database: "disconnected",
        error: error instanceof Error ? error.message : "Database error",
      },
      500
    );
  }
});

// Fallback 404
app.notFound((c) => {
  return c.json({ error: "Not Found" }, 404);
});

export default app;
