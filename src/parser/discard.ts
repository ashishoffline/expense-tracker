export type DiscardReason = "OTP";

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
 * Universal Ingestion Discard Registry.
 * Only bank-agnostic, 100% confidence non-spend patterns (OTPs, verification codes).
 * All other messages proceed to the bank parser; if unmatched, they land in unparsed_transactions.
 */
const DISCARD_RULES: DiscardRuleDefinition[] = [
  {
    name: "One-Time Password",
    reason: "OTP",
    regex: /\bOTP\b|One-Time Password/i,
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

