export interface ParsedTransaction {
  amount: number | null;
  type: "DEBIT" | "CREDIT";
  merchant: string | null;
  last4: string | null;
  method: "CARD" | "UPI" | "NETBANKING" | null;
  category: string;
  transactionDate: string | null;
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
// 2. CATEGORY DICTIONARY & CANONICAL MERCHANTS
// ============================================================================
const CATEGORY_MAP: Record<string, string[]> = {
  dining: [
    "swiggy", "zomato", "eats", "restaurant", "cafe", "burger", "starbucks",
    "chai", "mcdonald", "dominos", "pizza", "kfc", "biryani", "subway",
    "haldiram", "crush corner", "food", "kitchen", "bakery", "sweets", "dhaba"
  ],
  groceries: [
    "blinkit", "zepto", "instamart", "bigbasket", "dmart", "natures basket",
    "supermarket", "grocery", "milk", "country delight", "bazaar", "fresh", "provisions"
  ],
  fuel: [
    "petrol", "fuel", "hpcl", "bpcl", "iocl", "shell", "cng", "auto lpg", "pump"
  ],
  travel: [
    "uber", "ola", "rapido", "irctc", "indigo", "air india", "makemytrip",
    "cleartrip", "fastag", "metro", "goibibo", "flight", "toll", "railways", "transit"
  ],
  shopping: [
    "amazon", "amazonpay", "flipkart", "myntra", "ajio", "zara", "h&m", "croma", "reliance",
    "tata cliq", "nykaa", "uniqlo", "retail", "decathlon", "lifestyle", "shoppers stop"
  ],
  utilities: [
    "bescom", "airtel", "jio", "vi", "vodafone", "electricity", "billdesk",
    "tatapower", "gas", "water", "broadband", "act fibernet", "recharge", "apple"
  ],
  entertainment: [
    "netflix", "spotify", "pvr", "inox", "bookmyshow", "hotstar", "prime video",
    "cinema", "youtube", "movie"
  ],
  healthcare: [
    "apollo", "pharmacy", "1mg", "practo", "medplus", "hospital", "dental",
    "doctor", "lab", "pharmeasy", "clinic", "medical"
  ],
  personal_care: [
    "urban company", "salon", "enrich", "haircut", "spa"
  ],
  investments: [
    "zerodha", "groww", "coin", "indmoney", "mutual fund", "sip", "uti"
  ],
  cc_bill: [
    "cred", "cheq", "credit card bill", "cc payment", "bill payment"
  ],
  rent: [
    "rent", "nobroker", "housing"
  ],
  education: [
    "school", "college", "fees", "udemy", "coursera"
  ]
};

const CANONICAL_MERCHANTS: Record<string, string> = {
  "FLIPKART INTERNET PRIVATE": "Flipkart",
  "FLIPKART": "Flipkart",
  "AMAZONPAYINDIAPRIVATET": "Amazon Pay",
  "AMAZON PAY IN G": "Amazon Pay",
  "AMAZON PAY": "Amazon Pay",
  "AMAZON": "Amazon",
  "UBER INDIA SYSTEMS": "Uber",
  "UBER": "Uber",
  "ZOMATO": "Zomato",
  "SWIGGY": "Swiggy",
  "SWIGGY FOOD": "Swiggy",
  "MYNTRA": "Myntra",
  "CLEARTRIP": "Cleartrip",
  "APPLE MEDIA SERVICES": "Apple",
  "APPLE": "Apple",
  "IRCTC": "IRCTC",
  "CRUSH CORNER": "Crush Corner",
  "BLINKIT": "Blinkit",
  "ZEPTO": "Zepto",
};

function cleanMerchantName(raw: string): string {
  let name = raw.trim();

  // Strip leading UPI prefix (e.g. "UPI-AMBUJ KUMAR" -> "AMBUJ KUMAR")
  if (/^UPI[-_\s]+/i.test(name)) {
    name = name.replace(/^UPI[-_\s]+/i, "").trim();
  }

  // Strip payment gateway prefixes (PYU*, PAYU*, RZP*, RAZORPAY*, BILLDESK*, CCAVENUE*, PAYTM*, AIRPAY*)
  name = name.replace(/^(?:PYU\*|PAYU\*|RZP\*|RAZORPAY\*|BILLDESK\*|CCAVENUE\*|PAYTM\*|AIRPAY\*)/i, "").trim();

  // Handle slash formats like "UPI/SWIGGY/12345"
  if (name.includes("/")) {
    const parts = name.split("/").map((p) => p.trim()).filter(Boolean);
    const candidate = parts.find((p) => p.toUpperCase() !== "UPI" && isNaN(Number(p)));
    if (candidate) name = candidate;
  }

  // Handle UPI VPA handles: "swiggy@icici" -> "swiggy"
  if (name.includes("@")) {
    name = name.split("@")[0].trim();
  }

  // Strip common corporate suffixes: PVTLTD, PVT LTD, PRIVATE LIMITED, LTD, LIMITED
  name = name.replace(/(?:[-_\s]+)?(?:PVT\s*LTD|PRIVATE\s*LIMITED|PVTLTD|LTD|LIMITED)$/i, "").trim();

  name = name.replace(/^[\W_]+|[\W_]+$/g, "").trim();

  // Common brand prefix shortcuts
  if (/^MYNTRA\b/i.test(name)) return "Myntra";
  if (/^FLIPKART\b/i.test(name)) return "Flipkart";
  if (/^APOLLO\b/i.test(name)) return "Apollo Pharmacy";
  if (/^AMAZON\b/i.test(name)) return "Amazon";
  if (/^SWIGGY\b/i.test(name)) return "Swiggy";
  if (/^ZOMATO\b/i.test(name)) return "Zomato";
  if (/^UBER\b/i.test(name)) return "Uber";

  const upper = name.toUpperCase();
  if (CANONICAL_MERCHANTS[upper]) {
    return CANONICAL_MERCHANTS[upper];
  }

  if (name === upper && name.length > 2) {
    name = name
      .toLowerCase()
      .split(" ")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
  }

  return name;
}

function inferCategory(merchant: string | null, rawMessage: string): string {
  if (merchant) {
    const merchantLower = merchant.toLowerCase();
    for (const [category, keywords] of Object.entries(CATEGORY_MAP)) {
      for (const kw of keywords) {
        if (kw === "cred") {
          if (/\bcred\b/i.test(merchant)) return category;
        } else if (merchantLower.includes(kw)) {
          return category;
        }
      }
    }
  }

  const textLower = rawMessage.toLowerCase();
  for (const [category, keywords] of Object.entries(CATEGORY_MAP)) {
    for (const kw of keywords) {
      if (kw === "cred") {
        if (/\bcred\b/i.test(rawMessage)) return category;
      } else if (textLower.includes(kw)) {
        return category;
      }
    }
  }

  return "others";
}

function normalizeDate(rawDate: string): string {
  // Format: YYYY-MM-DD:HH:MM:SS (HDFC card spend)
  const hdfcDateTime = rawDate.match(/^(\d{4}-\d{2}-\d{2}):(\d{2}:\d{2}:\d{2})$/);
  if (hdfcDateTime) {
    return `${hdfcDateTime[1]}T${hdfcDateTime[2]}`;
  }

  // Format: DD-MM (HDFC RuPay UPI) -> current year YYYY-MM-DD
  const ddMm = rawDate.match(/^(\d{2})-(\d{2})$/);
  if (ddMm) {
    const [, d, m] = ddMm;
    const y = new Date().getFullYear();
    return `${y}-${m}-${d}`;
  }

  // Format: DD-MM-YY HH:MM:SS
  const axisDate = rawDate.match(/^(\d{2})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/);
  if (axisDate) {
    const [, d, m, y, hh, mm, ss] = axisDate;
    return `20${y}-${m}-${d}T${hh}:${mm}:${ss}`;
  }

  // Format: DD/MM/YYYY or DD/MM/YY
  const slashDate = rawDate.match(/^(\d{2})\/(\d{2})\/(\d{2,4})$/);
  if (slashDate) {
    const [, d, m, rawY] = slashDate;
    const y = rawY.length === 2 ? `20${rawY}` : rawY;
    return `${y}-${m}-${d}`;
  }

  // Format: DD-Mon-YY or DD/Mon/YYYY [at HH:MM:SS] (04-Oct-26 or 05/OCT/2026 or 05-OCT-26 at 14:32:05)
  const monMap: Record<string, string> = {
    jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
    jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12"
  };
  const monDate = rawDate.match(/^(\d{2})[-/]([A-Za-z]{3})[-/](\d{2,4})(?:\s+(?:at\s+)?(\d{2}):(\d{2}):(\d{2}))?$/i);
  if (monDate) {
    const [, d, monStr, rawY, hh, mm, ss] = monDate;
    const m = monMap[monStr.toLowerCase()];
    if (m) {
      const y = rawY.length === 2 ? `20${rawY}` : rawY;
      if (hh && mm && ss) {
        return `${y}-${m}-${d}T${hh}:${mm}:${ss}`;
      }
      return `${y}-${m}-${d}`;
    }
  }

  return rawDate;
}

// ============================================================================
// 3. MAIN PARSER ENTRYPOINT
// ============================================================================
export function parseBankSms(message: string, sender?: string): ParsedTransaction {
  const cleanMsg = message.trim();

  // STEP 1: Sender-Keyed Template Matching
  if (sender) {
    const group = BANK_REGISTRY.find((g) => g.senderMatch.test(sender));
    if (group) {
      for (const t of group.templates) {
        const match = cleanMsg.match(t.regex);
        if (match && match.groups) {
          const { amount: amtStr, last4, merchant: rawMerchant, date: rawDate } = match.groups;

          const amount = amtStr ? Math.round(parseFloat(amtStr.replace(/,/g, "")) * 100) / 100 : null;
          const merchant = rawMerchant
            ? cleanMerchantName(rawMerchant)
            : t.type === "CREDIT"
              ? "Refund"
              : null;
          const category = inferCategory(merchant, cleanMsg);
          const transactionDate = rawDate ? normalizeDate(rawDate.trim()) : null;

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
  }

  // STEP 2: Fallback Generic Matcher (if sender didn't match or was unspecified)
  for (const group of BANK_REGISTRY) {
    for (const t of group.templates) {
      const match = cleanMsg.match(t.regex);
      if (match && match.groups) {
        const { amount: amtStr, last4, merchant: rawMerchant, date: rawDate } = match.groups;

        const amount = amtStr ? Math.round(parseFloat(amtStr.replace(/,/g, "")) * 100) / 100 : null;
        const merchant = rawMerchant
          ? cleanMerchantName(rawMerchant)
          : t.type === "CREDIT"
            ? "Refund"
            : null;
        const category = inferCategory(merchant, cleanMsg);
        const transactionDate = rawDate ? normalizeDate(rawDate.trim()) : null;

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
    transactionDate: null,
    templateName: undefined,
  };
}
