import { Hono } from "hono";
import type { Env } from "../types";

export const transactionsRoute = new Hono<{ Bindings: Env }>();

// 1. Transaction Summary endpoint (group by category or merchant)
transactionsRoute.get("/summary", async (c) => {
  try {
    const groupBy = (c.req.query("groupBy") || "category").toLowerCase();
    const type = (c.req.query("type") || "DEBIT").toUpperCase();
    const from = c.req.query("from");
    const to = c.req.query("to");

    let whereClause = "WHERE t.type = ?";
    const bindings: any[] = [type];

    if (from) {
      whereClause += " AND t.transaction_date >= ?";
      bindings.push(from);
    }
    if (to) {
      whereClause += " AND t.transaction_date <= ?";
      bindings.push(to);
    }

    if (groupBy === "merchant") {
      const query = `
        SELECT 
          COALESCE(t.merchant, t.sender) as key,
          COALESCE(t.merchant, t.sender) as name,
          COUNT(*) as count,
          COALESCE(ROUND(SUM(t.amount), 2), 0) as total_amount
        FROM transactions t
        ${whereClause}
        GROUP BY key
        ORDER BY total_amount DESC
      `;
      const { results } = await c.env.DB.prepare(query).bind(...bindings).all();
      return c.json(results);
    } else {
      // Default: group by category
      const query = `
        SELECT 
          t.category as key,
          COALESCE(c.name, t.category) as name,
          COALESCE(c.icon, '📦') as icon,
          COUNT(*) as count,
          COALESCE(ROUND(SUM(t.amount), 2), 0) as total_amount
        FROM transactions t
        LEFT JOIN categories c ON t.category = c.id
        ${whereClause}
        GROUP BY t.category
        ORDER BY total_amount DESC
      `;
      const { results } = await c.env.DB.prepare(query).bind(...bindings).all();
      return c.json(results);
    }
  } catch (error) {
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to generate summary",
      },
      500
    );
  }
});

// 2. Transaction List endpoint
transactionsRoute.get("/", async (c) => {
  try {
    const limit = Number(c.req.query("limit")) || 50;
    const month = c.req.query("month"); // e.g. "2026-10"

    let query = "SELECT * FROM transactions";
    const bindings: any[] = [];

    if (month) {
      query += " WHERE transaction_date LIKE ? || '%'";
      bindings.push(month);
    }

    query += " ORDER BY transaction_date DESC LIMIT ?";
    bindings.push(limit);

    const { results } = await c.env.DB.prepare(query).bind(...bindings).all();
    return c.json(results);
  } catch (error) {
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to fetch transactions",
      },
      500
    );
  }
});

