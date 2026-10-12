import { matchDiscardRule } from "../parser/discard";
import { parseBankSms, type ParsedTransaction } from "../parser";
import { toISTString } from "../parser/dates";
import { generateDedupId } from "../utils/crypto";

export interface CapturePayload {
  sender?: string;
  message?: string;
  receivedAt?: string;
  source?: string;
}

export interface ServiceResult {
  status: 200 | 201 | 400 | 500;
  data: Record<string, any>;
}

export interface ReprocessResult {
  success: boolean;
  processed: number;
  updated: number;
  deleted: number;
  stillUnparsed: number;
  results: any[];
}

interface UnparsedRow {
  id: string;
  sender: string;
  raw_message: string;
  transaction_date: string;
}

/**
 * Looks up an account ID matching card_last4 or account_last4.
 */
async function lookupAccountId(db: D1Database, last4: string | null): Promise<string | null> {
  if (!last4) return null;
  const acc = await db
    .prepare(`SELECT id FROM accounts WHERE card_last4 = ? OR account_last4 = ? LIMIT 1`)
    .bind(last4, last4)
    .first<{ id: string }>();
  return acc?.id ?? null;
}

/**
 * Ingests and processes an incoming SMS message.
 *
 * Pipeline:
 * 1. Discard check -> If matched, silently ignore with 200 (zero DB writes).
 * 2. Parse check -> Calls parseBankSms(message, sender, fallbackDate).
 *    - If parsed: inserts record with status='PARSED', all extracted fields, and created_at (IST).
 *    - If unparsed: inserts record with status='UNPARSED', raw message, and created_at (IST).
 */
export async function captureTransaction(
  db: D1Database,
  payload: CapturePayload
): Promise<ServiceResult> {
  const { sender, message, source, receivedAt } = payload;

  if (!sender || typeof sender !== "string" || !sender.trim()) {
    return { status: 400, data: { success: false, error: "Field 'sender' is required" } };
  }
  if (!message || typeof message !== "string" || !message.trim()) {
    return { status: 400, data: { success: false, error: "Field 'message' is required" } };
  }

  const cleanSender = sender.trim();
  const cleanMessage = message.trim();

  // 1. Deterministic Ingestion Discard Gate (Silently ignored, zero log noise)
  const discard = matchDiscardRule(cleanMessage);
  if (discard) {
    return {
      status: 200,
      data: {
        action: "ignored",
        reason: discard.reason,
        rule: discard.rule,
      },
    };
  }

  // 2. Identity & Timestamps
  const id = await generateDedupId(cleanSender, cleanMessage);
  const nowIST = toISTString();
  const normalizedReceivedAt = toISTString(receivedAt);
  const sourceUser = source?.trim() || "unknown";

  // 3. Parse Bank SMS
  const parsed = parseBankSms(cleanMessage, cleanSender, normalizedReceivedAt);

  try {
    if (parsed) {
      const accountId = await lookupAccountId(db, parsed.last4);

      const insertResult = await db.prepare(
        `INSERT INTO transactions (
          id, source_user, sender, raw_message, transaction_date,
          amount, type, merchant, account_id, category, method, status, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PARSED', ?)
        ON CONFLICT(id) DO NOTHING`
      )
        .bind(
          id,
          sourceUser,
          cleanSender,
          cleanMessage,
          parsed.transactionDate,
          parsed.amount,
          parsed.type,
          parsed.merchant,
          accountId,
          parsed.category,
          parsed.method,
          nowIST
        )
        .run();

      if (insertResult.meta.changes > 0) {
        return {
          status: 201,
          data: {
            action: "created",
            id,
            status: "PARSED",
            parsed: {
              amount: parsed.amount,
              type: parsed.type,
              merchant: parsed.merchant,
              category: parsed.category,
              account_id: accountId,
              transaction_date: parsed.transactionDate,
            },
          },
        };
      } else {
        return { status: 200, data: { action: "duplicate", id } };
      }
    } else {
      // Unparsed fallback: store raw text and timestamp so no data is ever lost
      const insertResult = await db.prepare(
        `INSERT INTO transactions (
          id, source_user, sender, raw_message, transaction_date,
          amount, type, merchant, account_id, category, method, status, created_at
        )
        VALUES (?, ?, ?, ?, ?, NULL, 'DEBIT', NULL, NULL, 'others', NULL, 'UNPARSED', ?)
        ON CONFLICT(id) DO NOTHING`
      )
        .bind(
          id,
          sourceUser,
          cleanSender,
          cleanMessage,
          normalizedReceivedAt,
          nowIST
        )
        .run();

      if (insertResult.meta.changes > 0) {
        return {
          status: 201,
          data: {
            action: "created",
            id,
            status: "UNPARSED",
            notice: "No bank template matched; saved raw message for review",
          },
        };
      } else {
        return { status: 200, data: { action: "duplicate", id } };
      }
    }
  } catch (error) {
    console.error(
      "[CAPTURE:DB_FAILURE]",
      JSON.stringify({
        id,
        error: error instanceof Error ? error.message : String(error),
        payload: { sender: cleanSender, message: cleanMessage },
      })
    );
    return {
      status: 500,
      data: {
        success: false,
        error: error instanceof Error ? error.message : "Database operation failed",
      },
    };
  }
}

/**
 * Reprocesses unparsed transactions in safe batches.
 *
 * Pipeline:
 * 1. Checks discard rule -> If matched, DELETES the row from DB (deterministic auto-cleanup).
 * 2. Runs parseBankSms -> If matched, UPDATES status to 'PARSED' with all extracted fields.
 * 3. If still unparsed -> leaves as 'UNPARSED'.
 */
export async function reprocessTransactions(
  db: D1Database,
  limit: number = 25
): Promise<ReprocessResult> {
  const safeLimit = Math.max(1, Math.min(limit, 100));

  const { results: rows } = await db.prepare(
    `SELECT id, sender, raw_message, transaction_date 
     FROM transactions 
     WHERE status = 'UNPARSED' 
     ORDER BY created_at ASC 
     LIMIT ?`
  ).bind(safeLimit).all<UnparsedRow>();

  const results: any[] = [];
  let updatedCount = 0;
  let deletedCount = 0;
  let stillUnparsedCount = 0;

  for (const row of rows) {
    // 1. Auto-cleanup discardable rows
    const discard = matchDiscardRule(row.raw_message);
    if (discard) {
      await db.prepare(`DELETE FROM transactions WHERE id = ?`).bind(row.id).run();
      deletedCount++;
      results.push({
        id: row.id,
        status: "DELETED",
        reason: discard.reason,
        rule: discard.rule,
        notice: "Matched discard rule and deleted from database",
      });
      continue;
    }

    // 2. Parse SMS
    const parsed = parseBankSms(row.raw_message, row.sender, row.transaction_date);
    if (parsed) {
      const accountId = await lookupAccountId(db, parsed.last4);

      await db.prepare(
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
        parsed.transactionDate,
        row.id
      ).run();

      updatedCount++;
      results.push({
        id: row.id,
        status: "PARSED",
        amount: parsed.amount,
        type: parsed.type,
        merchant: parsed.merchant,
        category: parsed.category,
        account_id: accountId,
        template: parsed.templateName,
      });
    } else {
      stillUnparsedCount++;
      results.push({
        id: row.id,
        status: "UNPARSED",
        sender: row.sender,
        notice: "No matching template found yet",
      });
    }
  }

  return {
    success: true,
    processed: rows.length,
    updated: updatedCount,
    deleted: deletedCount,
    stillUnparsed: stillUnparsedCount,
    results,
  };
}

// ============================================================================
// QUERY METHODS
// ============================================================================

export interface TransactionSummary {
  totalCount: number;
  totalDebit: number;
  totalCredit: number;
}

export interface GroupedSpend {
  groupingKey: string;
  name: string;
  icon?: string;
  count: number;
  totalAmount: number;
}

export interface TransactionDetail {
  id: string;
  sourceUser: string | null;
  sender: string;
  transactionDate: string;
  amount: number | null;
  type: string | null;
  merchant: string;
  method: string | null;
  category: string;
  categoryName: string;
  categoryIcon: string;
  accountName: string | null;
}

/**
 * Calculates high-level KPI summary for a given month (YYYY-MM).
 */
export async function getTransactionSummary(
  db: D1Database,
  monthPrefix: string
): Promise<TransactionSummary> {
  const result = await db
    .prepare(
      `SELECT 
        COUNT(*) as total_count,
        COALESCE(ROUND(SUM(CASE WHEN type = 'DEBIT' THEN amount ELSE 0 END), 2), 0) as total_debit,
        COALESCE(ROUND(SUM(CASE WHEN type = 'CREDIT' THEN amount ELSE 0 END), 2), 0) as total_credit
      FROM transactions 
      WHERE transaction_date LIKE ? || '%'`
    )
    .bind(monthPrefix)
    .first<{ total_count: number; total_debit: number; total_credit: number }>();

  return {
    totalCount: result?.total_count ?? 0,
    totalDebit: result?.total_debit ?? 0,
    totalCredit: result?.total_credit ?? 0,
  };
}

/**
 * Returns expenses grouped by category, merchant, or card for a given month (YYYY-MM).
 */
export async function getTransactionsGroupedBy(
  db: D1Database,
  monthPrefix: string,
  groupBy: "category" | "merchant" | "card"
): Promise<GroupedSpend[]> {
  if (groupBy === "category") {
    const { results } = await db
      .prepare(
        `SELECT 
          t.category as grouping_key,
          COALESCE(c.name, t.category) as name,
          COALESCE(c.icon, '📦') as icon,
          COUNT(*) as count,
          COALESCE(ROUND(SUM(t.amount), 2), 0) as total_amount
        FROM transactions t
        LEFT JOIN categories c ON t.category = c.id
        WHERE t.transaction_date LIKE ? || '%' AND t.type = 'DEBIT'
        GROUP BY t.category
        ORDER BY total_amount DESC`
      )
      .bind(monthPrefix)
      .all<{
        grouping_key: string;
        name: string;
        icon: string;
        count: number;
        total_amount: number;
      }>();

    return results.map((r) => ({
      groupingKey: r.grouping_key,
      name: r.name,
      icon: r.icon,
      count: r.count,
      totalAmount: r.total_amount,
    }));
  }

  if (groupBy === "merchant") {
    const { results } = await db
      .prepare(
        `SELECT 
          COALESCE(t.merchant, t.sender) as grouping_key,
          COALESCE(t.merchant, t.sender) as name,
          COUNT(*) as count,
          COALESCE(ROUND(SUM(t.amount), 2), 0) as total_amount
        FROM transactions t
        WHERE t.transaction_date LIKE ? || '%' AND t.type = 'DEBIT'
        GROUP BY grouping_key
        ORDER BY total_amount DESC
        LIMIT 10`
      )
      .bind(monthPrefix)
      .all<{
        grouping_key: string;
        name: string;
        count: number;
        total_amount: number;
      }>();

    return results.map((r) => ({
      groupingKey: r.grouping_key,
      name: r.name,
      count: r.count,
      totalAmount: r.total_amount,
    }));
  }

  if (groupBy === "card") {
    const { results } = await db
      .prepare(
        `SELECT 
          COALESCE(a.id, 'unlinked') as grouping_key,
          COALESCE(a.display_name, 'Other / Unlinked') as name,
          COUNT(*) as count,
          COALESCE(ROUND(SUM(t.amount), 2), 0) as total_amount
        FROM transactions t
        LEFT JOIN accounts a ON t.account_id = a.id
        WHERE t.transaction_date LIKE ? || '%' AND t.type = 'DEBIT'
        GROUP BY grouping_key
        ORDER BY total_amount DESC`
      )
      .bind(monthPrefix)
      .all<{
        grouping_key: string;
        name: string;
        count: number;
        total_amount: number;
      }>();

    return results.map((r) => ({
      groupingKey: r.grouping_key,
      name: r.name,
      count: r.count,
      totalAmount: r.total_amount,
    }));
  }

  return [];
}

/**
 * Returns all individual transactions for a given month (YYYY-MM).
 */
export async function getTransactions(
  db: D1Database,
  monthPrefix: string
): Promise<TransactionDetail[]> {
  const { results } = await db
    .prepare(
      `SELECT 
        t.id,
        t.source_user,
        t.sender,
        t.transaction_date,
        t.amount,
        t.type,
        COALESCE(t.merchant, t.sender) as merchant,
        t.method,
        t.category,
        COALESCE(c.name, t.category) as category_name,
        COALESCE(c.icon, '📦') as category_icon,
        a.display_name as account_name
      FROM transactions t
      LEFT JOIN categories c ON t.category = c.id
      LEFT JOIN accounts a ON t.account_id = a.id
      WHERE t.transaction_date LIKE ? || '%'
      ORDER BY t.transaction_date DESC`
    )
    .bind(monthPrefix)
    .all<{
      id: string;
      source_user: string | null;
      sender: string;
      transaction_date: string;
      amount: number | null;
      type: string | null;
      merchant: string;
      method: string | null;
      category: string;
      category_name: string;
      category_icon: string;
      account_name: string | null;
    }>();

  return results.map((r) => ({
    id: r.id,
    sourceUser: r.source_user,
    sender: r.sender,
    transactionDate: r.transaction_date,
    amount: r.amount,
    type: r.type,
    merchant: r.merchant,
    method: r.method,
    category: r.category,
    categoryName: r.category_name,
    categoryIcon: r.category_icon,
    accountName: r.account_name,
  }));
}

