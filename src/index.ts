import { Hono, type Context } from "hono";
import type { Env } from "./types";
import { renderDashboardHtml, renderAccessDeniedHtml } from "./routes/dashboard";
import { captureTransaction, reprocessTransactions } from "./services/transaction.service";

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

// 1. Dashboard UI (Protected)
const dashboardHandler = async (c: Context<{ Bindings: Env }>) => {
  if (!isAuthorized(c)) {
    return c.html(renderAccessDeniedHtml(), 401);
  }

  return renderDashboardHtml(c);
};

app.get("/", dashboardHandler);
app.get("/dashboard", dashboardHandler);

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

  const result = await captureTransaction(c.env.DB, body);
  return c.json(result.data, result.status);
});

// 3. Maintenance Reprocess (POST /transactions/reprocess - Protected)
app.post("/transactions/reprocess", async (c) => {
  if (!isAuthorized(c)) {
    return c.json({ success: false, error: "Unauthorized" }, 401);
  }

  const limit = Math.min(Number(c.req.query("limit")) || 25, 100);
  const result = await reprocessTransactions(c.env.DB, limit);
  return c.json(result);
});

// 4. Health Check (Public)
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
