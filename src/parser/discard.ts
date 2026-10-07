export type DiscardReason =
  | "OTP"
  | "SCHEDULED_REMINDER"
  | "REFUND_INITIATED"
  | "CC_BILL_PAYMENT";

export interface DiscardMatch {
  reason: DiscardReason;
  rule: string;
}

interface DiscardRuleDefinition {
  name: string;
  reason: DiscardReason;
  regex: RegExp;
}

/**
 * Deterministic Ingestion Discard Registry.
 * Concrete regex rules to filter non-spend SMS messages at the ingestion gate.
 */
const DISCARD_RULES: DiscardRuleDefinition[] = [
  // 1. One-Time Passwords
  {
    name: "OTP Verification",
    reason: "OTP",
    regex: /\bOTP\b|One-Time Password/i,
  },

  // 2. Scheduled Autopay / Bill Reminders (upcoming alert; real debit SMS arrives on due date)
  {
    name: "HDFC SmartPay Scheduled Alert",
    reason: "SCHEDULED_REMINDER",
    regex: /^SmartPay\s+Scheduled:\s*Rs\.?\s*[\d,.]+\s+for\s+.+?\s+will\s+auto-debit\s+via\s+HDFC\s+Bank\s+Credit\s+Card/i,
  },

  // 3. Advisory / Pending Refund Initiated Notifications (before actual credit adjusts on statement)
  {
    name: "HDFC Refund Initiated Advisory",
    reason: "REFUND_INITIATED",
    regex: /^Refund\s+initiated:\s*Amt:\s*Rs\.?\s*[\d,.]+\s+on\s+HDFC\s+Bank\s+Credit\s+Card\s+\d{4}\.To\s+receive\s+your\s+Refund/i,
  },

  // 4. Credit Card Bill Payments (internal debt settlements, not monthly consumption spends)
  {
    name: "HSBC Credit Card Payment Received",
    reason: "CC_BILL_PAYMENT",
    regex: /^Dear\s+Customer,\s+we\s+have\s+received\s+a\s+payment\s+of\s+INR\s+[\d,.]+\s+for\s+credit\s+card\s+ending\s+\d{4}\s+on\s+\d{2}-[A-Za-z]{3}-\d{2}\./i,
  },
  {
    name: "HDFC Card Online Payment Credited",
    reason: "CC_BILL_PAYMENT",
    regex: /^HDFC\s+Bank\s+Cardmember,\s+Online\s+Payment\s+of\s+Rs\.?\s*[\d,.]+.*?credited\s+to\s+your\s+card\s+ending\s+\d{4}\s+On\s+\d{2}\/[A-Za-z]{3}\/\d{4}/i,
  },
];

/**
 * Evaluates an incoming SMS against the discard rules.
 * Returns { reason, rule } if matched, or null if it should proceed to parser.
 */
export function matchDiscardRule(message: string): DiscardMatch | null {
  const cleanMsg = message.trim();
  for (const rule of DISCARD_RULES) {
    if (rule.regex.test(cleanMsg)) {
      return {
        reason: rule.reason,
        rule: rule.name,
      };
    }
  }
  return null;
}

