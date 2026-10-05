import { Hono } from "hono";
import type { Env } from "../types";

export const accountsRoute = new Hono<{ Bindings: Env }>();

accountsRoute.get("/", async (c) => {
  try {
    const status = c.req.query("status");
    let query = "SELECT * FROM accounts";
    const params: string[] = [];

    if (status) {
      query += " WHERE status = ?";
      params.push(status.toUpperCase());
    }

    query += " ORDER BY bank, variant";

    const stmt = params.length > 0
      ? c.env.DB.prepare(query).bind(...params)
      : c.env.DB.prepare(query);

    const { results } = await stmt.all();
    return c.json(results);
  } catch (error) {
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to fetch accounts",
      },
      500
    );
  }
});

