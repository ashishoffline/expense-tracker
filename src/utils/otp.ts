/**
 * Strong OTP pattern detector.
 * Only filters explicit OTP / One-Time Password phrases,
 * avoiding false positives with words like 'verification code' or 'security code'.
 */
const OTP_REGEX = /\bOTP\b|One-Time Password/i;

export function isOtpMessage(message: string): boolean {
  return OTP_REGEX.test(message);
}

