import { Hono } from "hono";
import type { Env } from "../types";
import { generateDedupId } from "../utils/crypto";
import { isOtpMessage } from "../utils/otp";

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

  // 3. Strong OTP Filtering
  if (isOtpMessage(message)) {
    return c.json({
      success: true,
      action: "ignored",
      reason: "OTP",
    });
  }

  // 4. Deterministic Identity / Deduplication Fingerprint
  const id = await generateDedupId(sender, message);
  const normalizedReceivedAt = receivedAt && !isNaN(Date.parse(receivedAt))
    ? new Date(receivedAt).toISOString()
    : new Date().toISOString();
  const sourceUser = source?.trim() || "unknown";

  // 5. Database Insertion with Conflict Handling
  try {
    const insertResult = await c.env.DB.prepare(
      `INSERT INTO transactions (id, source_user, sender, raw_message, transaction_date, status)
       VALUES (?, ?, ?, ?, ?, 'UNPARSED')
       ON CONFLICT(id) DO NOTHING`
    )
      .bind(id, sourceUser, sender.trim(), message.trim(), normalizedReceivedAt)
      .run();

    if (insertResult.meta.changes > 0) {
      return c.json(
        {
          action: "created",
          id,
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
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Database insertion failed",
      },
      500
    );
  }
});

