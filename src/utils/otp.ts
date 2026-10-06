/**
 * Strong OTP pattern detector.
 * Only filters explicit OTP / One-Time Password phrases,
 * avoiding false positives with words like 'verification code' or 'security code'.
 */
const OTP_REGEX = /\bOTP\b|One-Time Password/i;

export function isOtpMessage(message: string): boolean {
  return OTP_REGEX.test(message);
}

/**
 * Scheduled bill payment / autopay reminder detector.
 * Filters out upcoming debit notifications (e.g. SmartPay Scheduled) before actual transaction occurs.
 */
const SCHEDULED_REMINDER_REGEX = /\b(?:SmartPay\s+Scheduled|will\s+auto-debit|scheduled\s+to\s+auto-debit|auto-debit\s+scheduled)\b/i;

export function isScheduledReminderMessage(message: string): boolean {
  return SCHEDULED_REMINDER_REGEX.test(message);
}

