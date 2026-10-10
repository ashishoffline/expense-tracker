export interface MerchantRule {
  pattern: RegExp;
  merchant: string;
  category: string;
}

export interface ResolvedMerchant {
  merchant: string;
  category: string;
}

/**
 * Unified list of merchant recognition rules.
 * To add a new merchant: simply add { pattern: /keyword|vpa/i, merchant: "Name", category: "slug" }.
 */
export const MERCHANT_RULES: MerchantRule[] = [
  // 1. Food & Dining
  { pattern: /swiggy/i, merchant: "Swiggy", category: "dining" },
  { pattern: /zomato/i, merchant: "Zomato", category: "dining" },
  { pattern: /starbucks/i, merchant: "Starbucks", category: "dining" },
  { pattern: /mcdonald/i, merchant: "McDonald's", category: "dining" },
  { pattern: /domino/i, merchant: "Domino's", category: "dining" },
  { pattern: /pizza\s*hut/i, merchant: "Pizza Hut", category: "dining" },
  { pattern: /kfc/i, merchant: "KFC", category: "dining" },
  { pattern: /subway/i, merchant: "Subway", category: "dining" },
  { pattern: /burger\s*king/i, merchant: "Burger King", category: "dining" },
  { pattern: /haldiram/i, merchant: "Haldiram", category: "dining" },
  { pattern: /crush\s*corner/i, merchant: "Crush Corner", category: "dining" },
  { pattern: /dhaba/i, merchant: "Dhaba Square", category: "dining" },
  { pattern: /paytmqr63wqx9|chai\s*bhagaan/i, merchant: "Chai Bhagaan Cafe", category: "dining" },
  { pattern: /q855608779/i, merchant: "Momo Corner", category: "dining" },
  { pattern: /paytmqr63wr8x/i, merchant: "Golgappa Corner", category: "dining" },
  { pattern: /q524801717/i, merchant: "Kolkata Kathi Roll", category: "dining" },
  { pattern: /q321269231|udupi/i, merchant: "Sri Udupi Food Hub", category: "dining" },
  { pattern: /cafe|restaurant|bakery|biryani/i, merchant: "Food & Dining", category: "dining" },

  // 2. Groceries & Quick Commerce
  { pattern: /instamart/i, merchant: "Instamart", category: "groceries" },
  { pattern: /blinkit|blink\s*commerce/i, merchant: "Blinkit", category: "groceries" },
  { pattern: /zepto/i, merchant: "Zepto", category: "groceries" },
  { pattern: /bigbasket/i, merchant: "BigBasket", category: "groceries" },
  { pattern: /dmart/i, merchant: "DMart", category: "groceries" },
  { pattern: /natures\s*basket/i, merchant: "Nature's Basket", category: "groceries" },
  { pattern: /country\s*delight/i, merchant: "Country Delight", category: "groceries" },

  // 3. Shopping & E-Commerce
  { pattern: /flipkart|fkrt/i, merchant: "Flipkart", category: "shopping" },
  { pattern: /amazon|amzn/i, merchant: "Amazon", category: "shopping" },
  { pattern: /myntra/i, merchant: "Myntra", category: "shopping" },
  { pattern: /firstcry/i, merchant: "FirstCry", category: "shopping" },
  { pattern: /ajio/i, merchant: "Ajio", category: "shopping" },
  { pattern: /zara/i, merchant: "Zara", category: "shopping" },
  { pattern: /h&m/i, merchant: "H&M", category: "shopping" },
  { pattern: /croma/i, merchant: "Croma", category: "shopping" },
  { pattern: /reliance/i, merchant: "Reliance", category: "shopping" },
  { pattern: /tata\s*cliq/i, merchant: "Tata CLiQ", category: "shopping" },
  { pattern: /nykaa/i, merchant: "Nykaa", category: "shopping" },
  { pattern: /decathlon/i, merchant: "Decathlon", category: "shopping" },
  { pattern: /uniqlo/i, merchant: "Uniqlo", category: "shopping" },

  // 4. Personal Care & Services
  { pattern: /urban\s*clap|urbanclap|urban\s*company|urbancompany/i, merchant: "Urban Company", category: "personal_care" },
  { pattern: /s1u0sbf|lakundinni/i, merchant: "Lakundinni Sumangala", category: "personal_care" },
  { pattern: /enrich|salon|spa|haircut/i, merchant: "Salon & Spa", category: "personal_care" },

  // 5. Bills & Utilities
  { pattern: /nobrokerhood|nobroker\s*hood/i, merchant: "NoBrokerHood", category: "utilities" },
  { pattern: /tata\s*payments|tata\s*pay/i, merchant: "Tata Pay", category: "utilities" },
  { pattern: /bescom/i, merchant: "BESCOM", category: "utilities" },
  { pattern: /airtel/i, merchant: "Airtel", category: "utilities" },
  { pattern: /jio/i, merchant: "Jio", category: "utilities" },
  { pattern: /vodafone|\bvi\b/i, merchant: "Vi", category: "utilities" },
  { pattern: /act\s*fibernet/i, merchant: "ACT Fibernet", category: "utilities" },
  { pattern: /tatapower|tata\s*power/i, merchant: "Tata Power", category: "utilities" },
  { pattern: /billdesk/i, merchant: "BillDesk", category: "utilities" },

  // 6. Travel & Transit
  { pattern: /uber/i, merchant: "Uber", category: "travel" },
  { pattern: /ola|\bani\s*tech\b/i, merchant: "Ola", category: "travel" },
  { pattern: /rapido/i, merchant: "Rapido", category: "travel" },
  { pattern: /irctc/i, merchant: "IRCTC", category: "travel" },
  { pattern: /indigo/i, merchant: "IndiGo", category: "travel" },
  { pattern: /air\s*india/i, merchant: "Air India", category: "travel" },
  { pattern: /makemytrip/i, merchant: "MakeMyTrip", category: "travel" },
  { pattern: /cleartrip/i, merchant: "Cleartrip", category: "travel" },
  { pattern: /fastag|metro/i, merchant: "Transit & Toll", category: "travel" },

  // 7. Fuel
  { pattern: /petrol|fuel|hpcl|bpcl|iocl|shell/i, merchant: "Fuel", category: "fuel" },

  // 8. Health & Medical
  { pattern: /apollo/i, merchant: "Apollo Pharmacy", category: "healthcare" },
  { pattern: /1mg/i, merchant: "1mg", category: "healthcare" },
  { pattern: /pharmeasy/i, merchant: "PharmEasy", category: "healthcare" },
  { pattern: /practo/i, merchant: "Practo", category: "healthcare" },
  { pattern: /medplus/i, merchant: "MedPlus", category: "healthcare" },

  // 9. Entertainment
  { pattern: /netflix/i, merchant: "Netflix", category: "entertainment" },
  { pattern: /spotify/i, merchant: "Spotify", category: "entertainment" },
  { pattern: /pvr|inox/i, merchant: "PVR INOX", category: "entertainment" },
  { pattern: /bookmyshow/i, merchant: "BookMyShow", category: "entertainment" },
  { pattern: /apple/i, merchant: "Apple", category: "entertainment" },
  { pattern: /hotstar/i, merchant: "Hotstar", category: "entertainment" },
  { pattern: /prime\s*video/i, merchant: "Prime Video", category: "entertainment" },

  // 10. Investments
  { pattern: /zerodha/i, merchant: "Zerodha", category: "investments" },
  { pattern: /groww/i, merchant: "Groww", category: "investments" },
  { pattern: /indmoney/i, merchant: "INDmoney", category: "investments" },

  // 11. Rent
  { pattern: /nobroker/i, merchant: "NoBroker", category: "rent" },

  // 12. Credit Card Bill
  { pattern: /cred/i, merchant: "CRED", category: "cc_bill" },
  { pattern: /cheq/i, merchant: "Cheq", category: "cc_bill" },
];

/**
 * Resolves merchant and category from the extracted raw merchant string.
 * Matches against MERCHANT_RULES; if unmapped, keeps raw merchant name and sets category to 'others'.
 */
export function resolveMerchant(rawMerchant: string | null): ResolvedMerchant {
  const name = rawMerchant?.trim();
  if (!name) {
    return { merchant: "Unknown", category: "others" };
  }

  for (const rule of MERCHANT_RULES) {
    if (rule.pattern.test(name)) {
      return {
        merchant: rule.merchant,
        category: rule.category,
      };
    }
  }

  return {
    merchant: name,
    category: "others",
  };
}

