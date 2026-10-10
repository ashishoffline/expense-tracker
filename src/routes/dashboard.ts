import { Hono } from "hono";
import type { Env } from "../types";

export const dashboardRoute = new Hono<{ Bindings: Env }>();

interface KpiSummary {
  total_count: number;
  total_debit: number;
  total_credit: number;
}

interface CategorySpend {
  category_id: string;
  category_name: string;
  icon: string;
  count: number;
  total_amount: number;
}

interface MerchantSpend {
  merchant: string;
  count: number;
  total_amount: number;
}

interface TransactionRow {
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
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

dashboardRoute.get("/", async (c) => {
  const now = new Date();
  const selectedYear = c.req.query("year") || now.getFullYear().toString();
  const selectedMonth = (c.req.query("month") || (now.getMonth() + 1).toString()).padStart(2, "0");
  const monthPrefix = `${selectedYear}-${selectedMonth}`;

  try {
    // 1. KPI Stats
    const kpi = await c.env.DB.prepare(`
      SELECT 
        COUNT(*) as total_count,
        COALESCE(ROUND(SUM(CASE WHEN type = 'DEBIT' THEN amount ELSE 0 END), 2), 0) as total_debit,
        COALESCE(ROUND(SUM(CASE WHEN type = 'CREDIT' THEN amount ELSE 0 END), 2), 0) as total_credit
      FROM transactions 
      WHERE transaction_date LIKE ? || '%'
    `).bind(monthPrefix).first<KpiSummary>() || { total_count: 0, total_debit: 0, total_credit: 0 };

    // 2. Category Breakdown
    const { results: categories } = await c.env.DB.prepare(`
      SELECT 
        t.category as category_id,
        COALESCE(c.name, t.category) as category_name,
        COALESCE(c.icon, '📦') as icon,
        COUNT(*) as count,
        COALESCE(ROUND(SUM(t.amount), 2), 0) as total_amount
      FROM transactions t
      LEFT JOIN categories c ON t.category = c.id
      WHERE t.transaction_date LIKE ? || '%' AND t.type = 'DEBIT'
      GROUP BY t.category
      ORDER BY total_amount DESC
    `).bind(monthPrefix).all<CategorySpend>();

    // 3. Top Merchants
    const { results: merchants } = await c.env.DB.prepare(`
      SELECT 
        COALESCE(merchant, sender) as merchant,
        COUNT(*) as count,
        COALESCE(ROUND(SUM(amount), 2), 0) as total_amount
      FROM transactions
      WHERE transaction_date LIKE ? || '%' AND type = 'DEBIT'
      GROUP BY merchant
      ORDER BY total_amount DESC
      LIMIT 10
    `).bind(monthPrefix).all<MerchantSpend>();

    // 4. Individual Transactions Feed
    const { results: transactions } = await c.env.DB.prepare(`
      SELECT 
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
      ORDER BY t.transaction_date DESC
    `).bind(monthPrefix).all<TransactionRow>();

    // Helper formatter for INR
    const formatINR = (amt: number) => {
      return new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR",
        maximumFractionDigits: 2,
      }).format(amt);
    };

    const monthOptions = MONTH_NAMES.map((name, i) => {
      const val = (i + 1).toString().padStart(2, "0");
      const sel = val === selectedMonth ? "selected" : "";
      return `<option value="${val}" ${sel}>${name}</option>`;
    }).join("");

    const yearNum = parseInt(selectedYear, 10);
    const years = [yearNum - 1, yearNum, yearNum + 1];
    const yearOptions = years.map((y) => {
      const sel = y.toString() === selectedYear ? "selected" : "";
      return `<option value="${y}" ${sel}>${y}</option>`;
    }).join("");

    const maxCatSpend = categories.length > 0 ? categories[0].total_amount : 1;

    const categoryRowsHtml = categories.length === 0
      ? `<p class="text-sm text-slate-400 py-4">No category spending recorded for this month.</p>`
      : categories.map((cat) => {
        const pct = Math.min(100, Math.round((cat.total_amount / (kpi.total_debit || 1)) * 100));
        return `
            <div class="py-2.5 border-b border-slate-800 last:border-0">
              <div class="flex items-center justify-between text-sm mb-1">
                <span class="flex items-center gap-2 text-slate-200">
                  <span class="text-base">${cat.icon}</span>
                  <span class="font-medium">${cat.category_name}</span>
                  <span class="text-xs text-slate-500">(${cat.count})</span>
                </span>
                <span class="font-semibold text-slate-100">${formatINR(cat.total_amount)}</span>
              </div>
              <div class="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
                <div class="bg-indigo-500 h-1.5 rounded-full" style="width: ${pct}%"></div>
              </div>
            </div>
          `;
      }).join("");

    const merchantRowsHtml = merchants.length === 0
      ? `<p class="text-sm text-slate-400 py-4">No merchant transactions for this month.</p>`
      : merchants.map((m) => {
        return `
            <div class="flex items-center justify-between py-2 border-b border-slate-800 last:border-0 text-sm">
              <div class="flex items-center gap-2">
                <span class="font-medium text-slate-200">${m.merchant}</span>
                <span class="text-xs text-slate-500">(${m.count})</span>
              </div>
              <span class="font-semibold text-slate-100">${formatINR(m.total_amount)}</span>
            </div>
          `;
      }).join("");

    const transactionRowsHtml = transactions.length === 0
      ? `<tr><td colspan="6" class="text-center py-8 text-slate-400">No transactions recorded for ${MONTH_NAMES[parseInt(selectedMonth, 10) - 1]} ${selectedYear}.</td></tr>`
      : transactions.map((t) => {
        const isDebit = t.type !== "CREDIT";
        const amtClass = isDebit ? "text-slate-100" : "text-emerald-400";
        const amtPrefix = isDebit ? "-" : "+";
        const dateStr = t.transaction_date ? t.transaction_date.replace("T", " ").substring(0, 16) : "-";
        const userBadge = t.source_user
          ? `<span class="px-2 py-0.5 rounded text-xs bg-slate-800 text-slate-300 font-mono">${t.source_user}</span>`
          : "";

        return `
            <tr class="border-b border-slate-800 hover:bg-slate-800/40 transition">
              <td class="py-3 px-4 text-xs text-slate-400 whitespace-nowrap font-mono">${dateStr}</td>
              <td class="py-3 px-4 text-sm font-medium text-slate-100">
                ${t.merchant}
                <div class="text-xs text-slate-500">${t.sender}</div>
              </td>
              <td class="py-3 px-4 text-xs whitespace-nowrap">
                <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-slate-800 text-slate-200">
                  <span>${t.category_icon}</span>
                  <span>${t.category_name}</span>
                </span>
              </td>
              <td class="py-3 px-4 text-xs text-slate-400 whitespace-nowrap">
                ${t.account_name || '<span class="text-slate-600">-</span>'}
              </td>
              <td class="py-3 px-4 text-xs text-center">${userBadge}</td>
              <td class="py-3 px-4 text-sm font-semibold text-right ${amtClass} whitespace-nowrap">
                ${amtPrefix}${formatINR(t.amount || 0)}
              </td>
            </tr>
          `;
      }).join("");

    const html = `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Expense Tracker</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  </style>
</head>
<body class="bg-slate-950 text-slate-100 min-h-screen">
  <!-- Top Navigation -->
  <header class="border-b border-slate-800 bg-slate-900/60 backdrop-blur sticky top-0 z-10">
    <div class="max-w-6xl mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-4">
      <div class="flex items-center gap-3">
        <span class="text-2xl">💳</span>
        <div>
          <h1 class="font-bold text-lg leading-tight text-white">Expense Tracker</h1>
          <p class="text-xs text-slate-400">Personal & Shared Finances</p>
        </div>
      </div>

      <!-- Month & Year Filter Form -->
      <form method="GET" action="/" class="flex items-center gap-2">
        <select name="month" onchange="this.form.submit()" class="bg-slate-800 text-slate-200 text-sm rounded-lg px-3 py-1.5 border border-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500">
          ${monthOptions}
        </select>
        <select name="year" onchange="this.form.submit()" class="bg-slate-800 text-slate-200 text-sm rounded-lg px-3 py-1.5 border border-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500">
          ${yearOptions}
        </select>
      </form>

      <div class="flex items-center gap-3 text-xs">
        <a href="/docs" class="px-3 py-1.5 rounded-lg bg-indigo-600/80 hover:bg-indigo-600 text-white font-medium transition">API Docs</a>
        <a href="/health" class="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition">Health</a>
      </div>
    </div>
  </header>

  <main class="max-w-6xl mx-auto px-4 py-6 space-y-6">
    <!-- KPI Summary Cards -->
    <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
      <div class="bg-slate-900 border border-slate-800 rounded-xl p-5">
        <div class="text-xs font-medium text-slate-400 uppercase tracking-wider mb-1">Total Spent (Debits)</div>
        <div class="text-2xl font-bold text-white">${formatINR(kpi.total_debit)}</div>
        <div class="text-xs text-slate-500 mt-2">${kpi.total_count} transactions recorded</div>
      </div>

      <div class="bg-slate-900 border border-slate-800 rounded-xl p-5">
        <div class="text-xs font-medium text-slate-400 uppercase tracking-wider mb-1">Total Received (Credits)</div>
        <div class="text-2xl font-bold text-emerald-400">${formatINR(kpi.total_credit)}</div>
        <div class="text-xs text-slate-500 mt-2">Refunds & Cashback</div>
      </div>

      <div class="bg-slate-900 border border-slate-800 rounded-xl p-5">
        <div class="text-xs font-medium text-slate-400 uppercase tracking-wider mb-1">Active Month</div>
        <div class="text-2xl font-bold text-indigo-400">${MONTH_NAMES[parseInt(selectedMonth, 10) - 1]} ${selectedYear}</div>
        <div class="text-xs text-slate-500 mt-2">Instant edge calculation via D1</div>
      </div>
    </div>

    <!-- Category & Merchant Breakdowns -->
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <!-- Category Breakdown -->
      <div class="bg-slate-900 border border-slate-800 rounded-xl p-5">
        <h2 class="text-base font-semibold text-white mb-3 flex items-center justify-between">
          <span>Spend by Category</span>
          <span class="text-xs text-slate-500 font-normal">${categories.length} categories</span>
        </h2>
        <div>${categoryRowsHtml}</div>
      </div>

      <!-- Merchant Breakdown -->
      <div class="bg-slate-900 border border-slate-800 rounded-xl p-5">
        <h2 class="text-base font-semibold text-white mb-3 flex items-center justify-between">
          <span>Top Merchants</span>
          <span class="text-xs text-slate-500 font-normal">Top 10 payees</span>
        </h2>
        <div>${merchantRowsHtml}</div>
      </div>
    </div>

    <!-- Individual Transactions Feed -->
    <div class="bg-slate-900 border border-slate-800 rounded-xl p-5">
      <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4">
        <div>
          <h2 class="text-base font-semibold text-white">Individual Transactions</h2>
          <p class="text-xs text-slate-400">All parsed expenses for ${MONTH_NAMES[parseInt(selectedMonth, 10) - 1]} ${selectedYear}</p>
        </div>
        <input 
          type="text" 
          id="searchInput" 
          placeholder="Filter by merchant or category..." 
          class="bg-slate-800 border border-slate-700 text-xs text-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500 w-full sm:w-64"
          onkeyup="filterTable()"
        />
      </div>

      <div class="overflow-x-auto">
        <table class="w-full text-left" id="txnTable">
          <thead>
            <tr class="border-b border-slate-800 text-xs font-semibold text-slate-400 uppercase tracking-wider">
              <th class="py-3 px-4">Date</th>
              <th class="py-3 px-4">Merchant / Sender</th>
              <th class="py-3 px-4">Category</th>
              <th class="py-3 px-4">Account / Card</th>
              <th class="py-3 px-4 text-center">User</th>
              <th class="py-3 px-4 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            ${transactionRowsHtml}
          </tbody>
        </table>
      </div>
    </div>
  </main>

  <script>
    function filterTable() {
      const q = document.getElementById('searchInput').value.toLowerCase();
      const rows = document.querySelectorAll('#txnTable tbody tr');
      rows.forEach(r => {
        const text = r.innerText.toLowerCase();
        r.style.display = text.includes(q) ? '' : 'none';
      });
    }
  </script>
</body>
</html>`;

    return c.html(html);
  } catch (error) {
    return c.html(`
      <div style="font-family: sans-serif; padding: 2rem; background: #0f172a; color: #f87171; min-height: 100vh;">
        <h2>Failed to load dashboard</h2>
        <p>${error instanceof Error ? error.message : "Unknown error"}</p>
        <p><a href="/docs" style="color: #818cf8;">Go to API Docs</a></p>
      </div>
    `, 500);
  }
});

