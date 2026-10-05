import { Hono } from "hono";
import { swaggerUI } from "@hono/swagger-ui";
import type { Env } from "./types";
import { dashboardRoute } from "./routes/dashboard";
import { captureRoute } from "./routes/capture";
import { transactionsRoute } from "./routes/transactions";
import { accountsRoute } from "./routes/accounts";
import { categoriesRoute } from "./routes/categories";
import { openApiSpec } from "./openapi";

const app = new Hono<{ Bindings: Env }>();

// 1. Base route: Server-Rendered Interactive HTML Dashboard
app.route("/", dashboardRoute);

// 2. Interactive Swagger UI & OpenAPI Specification
app.get("/doc", (c) => c.json(openApiSpec));
app.get("/docs", swaggerUI({ url: "/doc" }));
app.get("/swagger", (c) => c.redirect("/docs"));

// 3. Health check endpoint
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

// 4. Ingestion Webhook (POST /capture for iOS Shortcuts)
app.route("/capture", captureRoute);

// 5. Transactions API (GET /transactions and GET /transactions/summary)
app.route("/transactions", transactionsRoute);

// 6. Metadata APIs
app.route("/accounts", accountsRoute);
app.route("/categories", categoriesRoute);

// Fallback 404
app.notFound((c) => {
  return c.json({ error: "Not Found" }, 404);
});

export default app;
