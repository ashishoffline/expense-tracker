import { Hono } from "hono";
import type { Env } from "../types";
import { generateDedupId } from "../utils/crypto";
import { matchDiscardRule } from "../parser/discard";
import { parseBankSms } from "../parser";

export const captureRoute = new Hono<{ Bindings: Env }>();

interface CaptureBody {
  receivedAt?: string;
  sender?: string;
  message?: string;
  source?: string;
}

captureRoute.post("/", async (c) => {
  // 1. Ingestion Bearer Token Authentication
  const authHeader = c.req.header("Authorization");
  const expectedToken = c.env.INGESTION_TOKEN;

  if (!authHeader || authHeader !== `Bearer ${expectedToken}`) {
    console.warn("[CAPTURE:AUTH_FAIL]", JSON.stringify({
      ip: c.req.header("CF-Connecting-IP") || "unknown",
      userAgent: c.req.header("User-Agent") || "unknown",
      hasHeader: Boolean(authHeader),
    }));
    return c.json({ success: false, error: "Unauthorized" }, 401);
  }

  // 2. Body Validation
  let body: CaptureBody;
  try {
    body = await c.req.json<CaptureBody>();
  } catch {
    return c.json({ success: false, error: "Invalid JSON payload" }, 400);
  }

  const { sender, message, source, receivedAt } = body;

  if (!sender || typeof sender !== "string" || !sender.trim()) {
    return c.json({ success: false, error: "Field 'sender' is required" }, 400);
  }

  if (!message || typeof message !== "string" || !message.trim()) {
    return c.json({ success: false, error: "Field 'message' is required" }, 400);
  }

  // 3. Deterministic Ingestion Discard Gate (Silently ignored, zero log noise)
  const discard = matchDiscardRule(message);
  if (discard) {
    return c.json({
      action: "ignored",
      reason: discard.reason,
      rule: discard.rule,
    }, 200);
  }

  // 4. Deterministic Identity / Deduplication Fingerprint
  const id = await generateDedupId(sender, message);
  const normalizedReceivedAt = receivedAt && !isNaN(Date.parse(receivedAt))
    ? new Date(receivedAt).toISOString()
    : new Date().toISOString();
  const sourceUser = source?.trim() || "unknown";

  // 5. Parse Bank SMS via Sender-Keyed Template Registry
  const parsed = parseBankSms(message, sender.trim());
  const status = parsed.amount !== null ? "PARSED" : "UNPARSED";

  // Use SMS datetime ONLY if it includes a complete time component;
  // otherwise, take the full timestamp from the request payload (receivedAt).
  const txnDate = (parsed.transactionDate && parsed.hasTime)
    ? parsed.transactionDate
    : normalizedReceivedAt;

  // 6. Database Operations with Failure Replay Logging
  try {
    let accountId: string | null = null;
    if (parsed.last4) {
      const acc = await c.env.DB.prepare(
        `SELECT id FROM accounts WHERE card_last4 = ? OR account_last4 = ? LIMIT 1`
      ).bind(parsed.last4, parsed.last4).first<{ id: string }>();

      if (acc) {
        accountId = acc.id;
      }
    }

    const insertResult = await c.env.DB.prepare(
      `INSERT INTO transactions (
        id, source_user, sender, raw_message, transaction_date,
        amount, type, merchant, account_id, category, method, status
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO NOTHING`
    )
      .bind(
        id,
        sourceUser,
        sender.trim(),
        message.trim(),
        txnDate,
        parsed.amount,
        parsed.type,
        parsed.merchant,
        accountId,
        parsed.category,
        parsed.method,
        status
      )
      .run();

    if (insertResult.meta.changes > 0) {
      return c.json(
        {
          action: "created",
          id,
          parsed: {
            amount: parsed.amount,
            type: parsed.type,
            merchant: parsed.merchant,
            category: parsed.category,
            account_id: accountId,
            status,
          },
        },
        201
      );
    } else {
      return c.json(
        {
          action: "duplicate",
          id,
        },
        200
      );
    }
  } catch (error) {
    // Only non-OTP database failures are logged with full payload for manual replay
    console.error(
      "[CAPTURE:DB_FAILURE_REPLAY]",
      JSON.stringify({
        id,
        error: error instanceof Error ? error.message : String(error),
        payload: { sender, message, source, receivedAt },
      })
    );

    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Database operation failed",
      },
      500
    );
  }
});
