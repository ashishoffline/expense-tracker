import { Hono } from "hono";
import type { Env } from "../types";
import { parseBankSms } from "../parser";
import { matchDiscardRule } from "../parser/discard";

export const transactionsRoute = new Hono<{ Bindings: Env }>();

// 1. Transaction Summary endpoint (group by category or merchant)
transactionsRoute.get("/summary", async (c) => {
  try {
    const groupBy = (c.req.query("groupBy") || "category").toLowerCase();
    const type = (c.req.query("type") || "DEBIT").toUpperCase();
    const from = c.req.query("from");
    const to = c.req.query("to");

    let whereClause = "WHERE t.type = ? AND t.status = 'PARSED'";
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
    const status = c.req.query("status"); // e.g. "PARSED", "UNPARSED", "DISCARDED"

    let query = "SELECT * FROM transactions";
    const conditions: string[] = [];
    const bindings: any[] = [];

    if (month) {
      conditions.push("transaction_date LIKE ? || '%'");
      bindings.push(month);
    }
    if (status) {
      conditions.push("status = ?");
      bindings.push(status.toUpperCase());
    }

    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(" AND ")}`;
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

// 3. Reprocess unparsed transactions endpoint (by ID or safe batch)
transactionsRoute.post("/reprocess", async (c) => {
  // 1. Ingestion Bearer Token Authentication
  const authHeader = c.req.header("Authorization");
  const expectedToken = c.env.INGESTION_TOKEN;

  if (!authHeader || authHeader !== `Bearer ${expectedToken}`) {
    return c.json({ success: false, error: "Unauthorized" }, 401);
  }

  try {
    let targetId = c.req.query("id");
    let limit = Math.min(Number(c.req.query("limit")) || 10, 25);

    if (!targetId && c.req.header("Content-Type")?.includes("application/json")) {
      try {
        const body = await c.req.json<{ id?: string; limit?: number }>();
        if (body.id) targetId = body.id;
        if (body.limit) limit = Math.min(body.limit, 25);
      } catch {
        // ignore JSON parse error, use query params
      }
    }

    interface UnparsedRow {
      id: string;
      sender: string;
      raw_message: string;
      transaction_date: string;
      status: string;
    }

    let rows: UnparsedRow[] = [];
    if (targetId) {
      const row = await c.env.DB.prepare(
        `SELECT id, sender, raw_message, transaction_date, status FROM transactions WHERE id = ? LIMIT 1`
      ).bind(targetId).first<UnparsedRow>();

      if (!row) {
        return c.json({ success: false, error: `Transaction ${targetId} not found` }, 404);
      }
      rows = [row];
    } else {
      const { results } = await c.env.DB.prepare(
        `SELECT id, sender, raw_message, transaction_date, status FROM transactions WHERE status = 'UNPARSED' ORDER BY created_at ASC LIMIT ?`
      ).bind(limit).all<UnparsedRow>();
      rows = results;
    }

    const reprocessedResults: any[] = [];
    let updatedCount = 0;
    let discardedCount = 0;
    let stillUnparsedCount = 0;

    for (const row of rows) {
      // Check if message matches an intentional discard pattern
      const discardMatch = matchDiscardRule(row.raw_message);
      if (discardMatch) {
        await c.env.DB.prepare(
          `UPDATE transactions SET status = 'DISCARDED' WHERE id = ?`
        ).bind(row.id).run();

        discardedCount++;
        reprocessedResults.push({
          id: row.id,
          status: "DISCARDED",
          reason: discardMatch.reason,
          rule: discardMatch.rule,
          notice: "Identified as non-spend notification and marked DISCARDED in database",
        });
        continue;
      }

      const parsed = parseBankSms(row.raw_message, row.sender);

      if (parsed.amount !== null) {
        let accountId: string | null = null;
        if (parsed.last4) {
          const acc = await c.env.DB.prepare(
            `SELECT id FROM accounts WHERE card_last4 = ? OR account_last4 = ? LIMIT 1`
          ).bind(parsed.last4, parsed.last4).first<{ id: string }>();
          if (acc) accountId = acc.id;
        }

        const txnDate = parsed.transactionDate || row.transaction_date;

        await c.env.DB.prepare(
          `UPDATE transactions SET
            amount = ?,
            type = ?,
            merchant = ?,
            account_id = ?,
            category = ?,
            method = ?,
            status = 'PARSED',
            transaction_date = ?
          WHERE id = ?`
        ).bind(
          parsed.amount,
          parsed.type,
          parsed.merchant,
          accountId,
          parsed.category,
          parsed.method,
          txnDate,
          row.id
        ).run();

        updatedCount++;
        reprocessedResults.push({
          id: row.id,
          status: "PARSED",
          amount: parsed.amount,
          type: parsed.type,
          merchant: parsed.merchant,
          account_id: accountId,
          category: parsed.category,
          method: parsed.method,
          template: parsed.templateName,
        });
      } else {
        stillUnparsedCount++;
        reprocessedResults.push({
          id: row.id,
          status: "UNPARSED",
          sender: row.sender,
          notice: "No matching template found yet",
        });
      }
    }

    return c.json({
      success: true,
      processed: rows.length,
      updated: updatedCount,
      discarded: discardedCount,
      stillUnparsed: stillUnparsedCount,
      results: reprocessedResults,
    });
  } catch (error) {
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Reprocessing failed",
      },
      500
    );
  }
});

