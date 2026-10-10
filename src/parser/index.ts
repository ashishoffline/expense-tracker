import { resolveMerchant } from "./merchants";
import { parseTransactionDate } from "./dates";

export interface ParsedTransaction {
  amount: number | null;
  type: "DEBIT" | "CREDIT";
  merchant: string | null;
  last4: string | null;
  method: "CARD" | "UPI" | "NETBANKING" | null;
  category: string;
  transactionDate: string;
  templateName?: string;
}

interface TemplateDefinition {
  name: string;
  type: "DEBIT" | "CREDIT";
  method: "CARD" | "UPI" | "NETBANKING";
  // Regex with named capture groups: amount, last4, merchant, date
  regex: RegExp;
}

interface BankTemplateGroup {
  bank: string;
  senderMatch: RegExp;
  templates: TemplateDefinition[];
}

// ============================================================================
// 1. SENDER-KEYED TEMPLATE REGISTRY
// ============================================================================
const BANK_REGISTRY: BankTemplateGroup[] = [
  // KOTAK BANK
  {
    bank: "KOTAK",
    senderMatch: /KOTAK/i,
    templates: [
      {
        name: "Kotak Debit Card Spend",
        type: "DEBIT",
        method: "CARD",
        regex: /^Rs\.(?<amount>[\d,.]+)\s+spent\s+via\s+Kotak\s+Debit\s+Card\s+[xX*]+(?<last4>\d{4})\s+at\s+(?<merchant>.+?)\s+on\s+(?<date>\d{2}\/\d{2}\/\d{4})/i,
      },
    ],
  },

  // HDFC BANK
  {
    bank: "HDFC",
    senderMatch: /HDFC/i,
    templates: [
      // Template A: HDFC UPI Sent / Mandate (Multi-line)
      {
        name: "HDFC UPI Sent",
        type: "DEBIT",
        method: "UPI",
        regex: /^(?:UPI\s+Mandate:\s*\n+)?Sent\s+Rs\.?\s*(?<amount>[\d,.]+)\s*\n+[fF]rom\s+HDFC\s+Bank\s+A\/[cC]\s+[*xX]?(?<last4>\d{4})\s*\n+To\s+(?<merchant>[^\r\n]+)\s*\n+(?:On\s+)?(?<date>\d{2}\/\d{2}\/\d{2,4})/im,
      },
      // Template B: HDFC Credit Card Spend (Single-line, handles both YYYY-MM-DD:HH:MM:SS and DD-Mon-YY)
      {
        name: "HDFC Card Spend",
        type: "DEBIT",
        method: "CARD",
        regex: /^Spent\s+Rs\.?\s*(?<amount>[\d,.]+)\s+on\s+HDFC\s+Bank\s+Card\s+(?<last4>\d{4})\s+at\s+(?<merchant>.+?)\s+on\s+(?<date>\d{4}-\d{2}-\d{2}:\d{2}:\d{2}:\d{2}|\d{2}-[A-Za-z]{3}-\d{2}(?:\s+at\s+\d{2}:\d{2}:\d{2})?)/i,
      },
      // Template C: HDFC RuPay Card on UPI (Multi-line)
      {
        name: "HDFC RuPay Card on UPI",
        type: "DEBIT",
        method: "UPI",
        regex: /^Txn\s+Rs\.?\s*(?<amount>[\d,.]+)\s*\n+On\s+HDFC\s+Bank\s+Card\s+(?<last4>\d{4})\s*\n+At\s+(?<merchant>[^\r\n]+)\s*\n+by\s+UPI\s+[\w]+\s*\n+On\s+(?<date>\d{2}-\d{2})/im,
      },
      // Template D: HDFC Refund
      {
        name: "HDFC Refund",
        type: "CREDIT",
        method: "CARD",
        regex: /^Refund\s+of\s+Rs\.?\s*(?<amount>[\d,.]+)\s+credited\s+to\s+your\s+HDFC\s+Bank\s+Card\s+(?<last4>\d{4})\s+from\s+(?<merchant>.+?)\s+on\s+(?<date>\d{2}-[A-Za-z]{3}-\d{2}(?:\s+at\s+\d{2}:\d{2}:\d{2})?)/i,
      },
      // Template E: HDFC Merchant Refund
      {
        name: "HDFC Merchant Refund",
        type: "CREDIT",
        method: "CARD",
        regex: /^Alert!\s+Rs\.?\s*(?<amount>[\d,.]+)\s+refunded\s+by\s+(?<merchant>.+?)\s+on\s+(?<date>\d{2}\/[A-Za-z]{3}\/\d{4})\s+&\s+adjusted\s+against\s+HDFC\s+Bank\s+Credit\s+Card\s+(?<last4>\d{4})/i,
      },
    ],
  },

  // ICICI BANK
  {
    bank: "ICICI",
    senderMatch: /ICICI/i,
    templates: [
      {
        name: "ICICI Card Spend",
        type: "DEBIT",
        method: "CARD",
        regex: /^(?:INR|Rs\.?)\s*(?<amount>[\d,.]+)\s+spent\s+(?:on|using)\s+ICICI\s+Bank\s+Card\s+[xX*]+(?<last4>\d{4})\s+on\s+(?<date>\d{2}-[A-Za-z]{3}-\d{2})\s+(?:at|on)\s+(?<merchant>[^.]+?)\.\s+Avl\s+(?:Limit|Lmt)/i,
      },
      {
        name: "ICICI Card Refund",
        type: "CREDIT",
        method: "CARD",
        regex: /^(?<merchant>.+?)\s+refund\s+of\s+Rs\.?\s*(?<amount>[\d,.]+)\s+credited\s+to\s+ICICI\s+Bank\s+Credit\s+Card\s+[xX*]+(?<last4>\d{4})\s+on\s+(?<date>\d{2}-[A-Za-z]{3}-\d{2})/i,
      },
    ],
  },

  // SBI CARD & BANK
  {
    bank: "SBI",
    senderMatch: /SBI/i,
    templates: [
      {
        name: "SBI Credit Card Spend",
        type: "DEBIT",
        method: "CARD",
        regex: /^Rs\.(?<amount>[\d,.]+)\s+spent\s+on\s+your\s+SBI\s+Credit\s+Card\s+ending\s+(?<last4>\d{4})\s+at\s+(?<merchant>[^.]+?)\s+on\s+(?<date>\d{2}\/\d{2}\/\d{2})/i,
      },
    ],
  },

  // BANK OF BARODA / SCAPIA
  {
    bank: "BOB",
    senderMatch: /BOB|SCAPIA/i,
    templates: [
      {
        name: "BOBCARD Scapia Txn Successful",
        type: "DEBIT",
        method: "CARD",
        regex: /^Your\s+txn\s+of\s+INR(?<amount>[\d,.]+)\s+AT\s+(?<merchant>.+?)\s+WAS\s+SUCCESSFUL\s+ON\s+YOUR\s+BOBCARD\s+SCAPIA.*?ending\s+with\s+(?<last4>\d{4})/i,
      },
    ],
  },

  // AXIS BANK
  {
    bank: "AXIS",
    senderMatch: /AXIS/i,
    templates: [
      {
        name: "Axis Bank Card Multi-line Spend",
        type: "DEBIT",
        method: "CARD",
        regex: /^Spent\s+INR\s+(?<amount>[\d,.]+)\s*\n+Axis\s+Bank\s+Card\s+no\.\s+[xX*]+(?<last4>\d{4})\s*\n+(?<date>\d{2}-\d{2}-\d{2}(?:\s+\d{2}:\d{2}:\d{2}(?:\s+IST)?)?)\s*\n+(?<merchant>[^\r\n]+)\s*\n+Avl\s+Limit/im,
      },
    ],
  },

  // HSBC
  {
    bank: "HSBC",
    senderMatch: /HSBC/i,
    templates: [
      {
        name: "HSBC Credit Card Used At",
        type: "DEBIT",
        method: "CARD",
        regex: /^HSBC\s+Credit\s+Card\s+[xX*]+(?<last4>\d{4})\s+used\s+at\s+(?<merchant>.+?)\s+for\s+INR\s+(?<amount>[\d,.]+)\s+on\s+(?<date>\d{2}\/\d{2}\/\d{2})/i,
      },
    ],
  },
];
// ============================================================================
// 2. MAIN PARSER ENTRYPOINT
// ============================================================================
export function parseBankSms(
  message: string,
  sender: string,
  fallbackDate: string
): ParsedTransaction {
  const cleanMsg = message.trim();
  const cleanSender = sender.trim();

  // STEP 1: Sender-Keyed Template Matching
  const group = BANK_REGISTRY.find((g) => g.senderMatch.test(cleanSender));
  if (group) {
    for (const t of group.templates) {
      const match = cleanMsg.match(t.regex);
      if (match && match.groups) {
        const { amount: amtStr, last4, merchant: rawMerchant, date: rawDate } = match.groups;

        const amount = amtStr ? Math.round(parseFloat(amtStr.replace(/,/g, "")) * 100) / 100 : null;
        const { merchant, category } = resolveMerchant(rawMerchant || (t.type === "CREDIT" ? "Refund" : null));
        const transactionDate = parseTransactionDate(rawDate, fallbackDate);

        return {
          amount,
          type: t.type,
          merchant,
          last4: last4 || null,
          method: t.method,
          category,
          transactionDate,
          templateName: t.name,
        };
      }
    }
  }

  // STEP 2: Fallback Generic Matcher (if sender didn't match a specific bank group)
  for (const group of BANK_REGISTRY) {
    for (const t of group.templates) {
      const match = cleanMsg.match(t.regex);
      if (match && match.groups) {
        const { amount: amtStr, last4, merchant: rawMerchant, date: rawDate } = match.groups;

        const amount = amtStr ? Math.round(parseFloat(amtStr.replace(/,/g, "")) * 100) / 100 : null;
        const { merchant, category } = resolveMerchant(rawMerchant || (t.type === "CREDIT" ? "Refund" : null));
        const transactionDate = parseTransactionDate(rawDate, fallbackDate);

        return {
          amount,
          type: t.type,
          merchant,
          last4: last4 || null,
          method: t.method,
          category,
          transactionDate,
          templateName: `Fallback:${t.name}`,
        };
      }
    }
  }

  // STEP 3: Return Unparsed if no template matched
  return {
    amount: null,
    type: "DEBIT",
    merchant: null,
    last4: null,
    method: null,
    category: "others",
    transactionDate: fallbackDate,
    templateName: undefined,
  };
}
