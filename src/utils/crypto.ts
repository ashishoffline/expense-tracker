/**
 * Generates a deterministic SHA-256 fingerprint from sender and normalized message.
 */
export async function generateDedupId(sender: string, message: string): Promise<string> {
  const normalized = `${sender.trim().toUpperCase()}:${message.trim()}`;
  const msgUint8 = new TextEncoder().encode(normalized);
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

