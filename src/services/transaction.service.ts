import { matchDiscardRule } from "../parser/discard";
import { parseBankSms, type ParsedTransaction } from "../parser";
import { toISTString } from "../parser/dates";
import { generateDedupId } from "../utils/crypto";

export interface CapturePayload {
  sender: string;
  message: string;
  receivedAt?: string;
  source?: string;
}

export interface ServiceResult {
  status: 200 | 201 | 400 | 500;
  data: Record<string, any>;
}

export interface ReprocessResult {
  success: boolean;
  requested: number;
  migrated: number;
  stillUnparsed: number;
  notFound: number;
  results: Array<{
    id: string;
    status: "PARSED" | "UNPARSED" | "NOT_FOUND";
    details?: any;
    error?: string;
  }>;
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
 * 1. Discard check -> If matched (universal OTP), silently ignore with 200 (zero DB writes).
 * 2. Parse check -> Calls parseBankSms(message, sender, fallbackDate).
 *    - If parsed: inserts into `transactions` (all financial fields guaranteed, zero NULLs).
 *    - If unparsed: moves into `unparsed_transactions` (quarantine DLQ table for manual review).
 */
export async function captureTransaction(
  db: D1Database,
  payload: CapturePayload
): Promise<ServiceResult> {
  const { sender, message, source, receivedAt } = payload;

  // 1. High-Confidence Universal Discard Gate (OTPs)
  const discard = matchDiscardRule(message);
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
  const id = await generateDedupId(sender, message);
  const nowIST = toISTString();
  const normalizedReceivedAt = toISTString(receivedAt);
  const sourceUser = source || "unknown";

  // 3. Parse Bank SMS
  const parsed = parseBankSms(message, sender, normalizedReceivedAt);

  try {
    if (parsed) {
      const accountId = await lookupAccountId(db, parsed.last4);

      const insertResult = await db.prepare(
        `INSERT INTO transactions (
          id, source_user, sender, raw_message, transaction_date,
          amount, type, merchant, account_id, category, method, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO NOTHING`
      )
        .bind(
          id,
          sourceUser,
          sender,
          message,
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
      // Unparsed fallback: quarantine into unparsed_transactions table (zero pollution in main ledger)
      const insertResult = await db.prepare(
        `INSERT INTO unparsed_transactions (
          id, source_user, sender, raw_message, transaction_date, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO NOTHING`
      )
        .bind(
          id,
          sourceUser,
          sender,
          message,
          normalizedReceivedAt,
          nowIST
        )
        .run();

      if (insertResult.meta.changes > 0) {
        return {
          status: 201,
          data: {
            action: "quarantined",
            id,
            notice: "No bank template matched; moved to unparsed_transactions for review",
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
        payload: { sender, message },
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
 * Reprocesses specific unparsed transactions by ID (1 to 5 IDs).
 * When newly matched by updated regex rules, atomically inserts into transactions
 * and deletes from unparsed_transactions.
 */
export async function reprocessTransactions(
  db: D1Database,
  ids: string[]
): Promise<ReprocessResult> {
  const placeholders = ids.map(() => "?").join(",");
  const { results: rows } = await db
    .prepare(
      `SELECT id, source_user, sender, raw_message, transaction_date, created_at 
       FROM unparsed_transactions 
       WHERE id IN (${placeholders})`
    )
    .bind(...ids)
    .all<{
      id: string;
      source_user: string | null;
      sender: string;
      raw_message: string;
      transaction_date: string;
      created_at: string;
    }>();

  const foundMap = new Map(rows.map((r) => [r.id, r]));
  const results: ReprocessResult["results"] = [];
  let migratedCount = 0;
  let stillUnparsedCount = 0;
  let notFoundCount = 0;

  for (const id of ids) {
    const row = foundMap.get(id);
    if (!row) {
      notFoundCount++;
      results.push({
        id,
        status: "NOT_FOUND",
        error: "Message ID not found in unparsed_transactions",
      });
      continue;
    }

    const parsed = parseBankSms(row.raw_message, row.sender, row.transaction_date);
    if (parsed) {
      const accountId = await lookupAccountId(db, parsed.last4);
      const nowIST = toISTString();

      // Atomically insert into transactions and delete from unparsed_transactions
      await db.batch([
        db.prepare(
          `INSERT INTO transactions (
            id, source_user, sender, raw_message, transaction_date,
            amount, type, merchant, account_id, category, method, created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            amount = excluded.amount,
            type = excluded.type,
            merchant = excluded.merchant,
            account_id = excluded.account_id,
            category = excluded.category,
            method = excluded.method,
            transaction_date = excluded.transaction_date`
        ).bind(
          row.id,
          row.source_user || "unknown",
          row.sender,
          row.raw_message,
          parsed.transactionDate,
          parsed.amount,
          parsed.type,
          parsed.merchant,
          accountId,
          parsed.category,
          parsed.method,
          row.created_at || nowIST
        ),
        db.prepare(`DELETE FROM unparsed_transactions WHERE id = ?`).bind(row.id),
      ]);

      migratedCount++;
      results.push({
        id: row.id,
        status: "PARSED",
        details: {
          amount: parsed.amount,
          type: parsed.type,
          merchant: parsed.merchant,
          category: parsed.category,
          account_id: accountId,
          transaction_date: parsed.transactionDate,
        },
      });
    } else {
      stillUnparsedCount++;
      results.push({
        id: row.id,
        status: "UNPARSED",
        details: {
          sender: row.sender,
          notice: "No matching bank template found yet; remains in unparsed_transactions",
        },
      });
    }
  }

  return {
    success: true,
    requested: ids.length,
    migrated: migratedCount,
    stillUnparsed: stillUnparsedCount,
    notFound: notFoundCount,
    results,
  };
}

// ============================================================================
// QUERY & UPDATE METHODS
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

export interface CategoryItem {
  id: string;
  name: string;
  icon: string | null;
}

export interface UpdateTransactionPayload {
  category?: string;
  exclude?: boolean;
}

/**
 * Calculates high-level KPI summary for a given month (YYYY-MM), excluding marked transactions.
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
      WHERE transaction_date LIKE ? || '%' AND exclude = 0`
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
 * Returns expenses grouped by category, merchant, or card for a given month (YYYY-MM), excluding marked transactions.
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
        WHERE t.transaction_date LIKE ? || '%' AND t.type = 'DEBIT' AND t.exclude = 0
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
        WHERE t.transaction_date LIKE ? || '%' AND t.type = 'DEBIT' AND t.exclude = 0
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
        WHERE t.transaction_date LIKE ? || '%' AND t.type = 'DEBIT' AND t.exclude = 0
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
 * Returns all individual non-excluded transactions for a given month (YYYY-MM).
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
      WHERE t.transaction_date LIKE ? || '%' AND t.exclude = 0
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

/**
 * Returns all available categories for dropdowns and selection.
 */
export async function getAllCategories(db: D1Database): Promise<CategoryItem[]> {
  const { results } = await db
    .prepare(`SELECT id, name, icon FROM categories ORDER BY name ASC`)
    .all<CategoryItem>();
  return results;
}

/**
 * Updates a transaction's category or exclude status.
 */
export async function updateTransaction(
  db: D1Database,
  id: string,
  payload: UpdateTransactionPayload
): Promise<{ success: boolean; error?: string }> {
  const fields: string[] = [];
  const values: any[] = [];

  if (payload.category !== undefined && typeof payload.category === "string" && payload.category.trim()) {
    fields.push("category = ?");
    values.push(payload.category.trim());
  }
  if (payload.exclude !== undefined && typeof payload.exclude === "boolean") {
    fields.push("exclude = ?");
    values.push(payload.exclude ? 1 : 0);
  }

  if (fields.length === 0) {
    return { success: false, error: "No valid fields provided to update ('category' or 'exclude')" };
  }

  values.push(id);
  const result = await db
    .prepare(`UPDATE transactions SET ${fields.join(", ")} WHERE id = ?`)
    .bind(...values)
    .run();

  if (result.meta.changes === 0) {
    return { success: false, error: "Transaction not found" };
  }

  return { success: true };
}

