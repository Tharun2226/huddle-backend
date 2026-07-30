/**
 * Shared regular expressions for receipt parsing.
 * Keep patterns centralized so OCR parsers stay readable.
 */

/**
 * Money with optional currency symbol / code.
 * IMPORTANT: use `[0-9]+` first — a leading `[0-9]{1,3}` alternative
 * greedily matched "468" out of "4680.56" and dropped the total.
 */
export const MONEY_PATTERN =
  /(?:₹|rs\.?|inr|usd|eur|gbp|\$|€|£)?\s*([0-9]+(?:,[0-9]{3})*(?:\.[0-9]{1,2})?)/gi;

/**
 * Final payable after tax — prefer these over "Total Amount" (pre-tax).
 * Indian hotel/restaurant slips often use "Bill Amount".
 */
export const FINAL_TOTAL_PATTERN =
  /\b(bill\s*amount|grand\s*total|net\s*payable|net\s*amount|amount\s*due|amount\s*payable|payable\s*amount|balance\s*due|total\s*due|amount\s*to\s*pay|to\s*pay|round\s*off\s*total|net\s*total)\b/i;

/** Pre-tax / item totals — must lose to Bill Amount. */
export const PRETAX_TOTAL_PATTERN =
  /\b(total\s*amount|sub\s*total|subtotal|item\s*total|food\s*total|goods\s*total)\b/i;

/** Weaker total keywords (still better than random numbers). */
export const TOTAL_KEYWORD_PATTERN =
  /\b(grand\s*total|amount\s*due|amount\s*payable|net\s*payable|net\s*amount|balance\s*due|total\s*due|payable\s*amount|total)\b/i;

/**
 * Bare "AMOUNT" label (fuel pumps etc.) including common OCR typos:
 * AMOUNT → AvoUNT / AMONT / AMUNT
 */
export const AMOUNT_LABEL_PATTERN =
  /\b(a\s*m\s*o\s*u\s*n\s*t|avo?unt|amont|amunt|amout)\b/i;

/** Fuel / unit price lines — must NOT be treated as total. */
export const UNIT_PRICE_PATTERN =
  /\b(rate|price\s*\/?\s*l(?:tr|itre)?|per\s*l(?:tr|itre)?|unit\s*price|mrp)\b/i;

/** Quantity / density / pump meta — ignore for total. */
export const FUEL_META_PATTERN =
  /\b(volume|density|nozzle|product|litre|liter|ltr|kg\s*\/\s*m)\b/i;

/** Tax / GST lines. */
export const TAX_KEYWORD_PATTERN =
  /\b(tax|gst|cgst|sgst|igst|vat|sales\s*tax|service\s*tax)\b/i;

/** Subtotal / tip / discount — deprioritize for "total". */
export const NON_TOTAL_PATTERN =
  /\b(sub\s*total|subtotal|tip|discount|cash\s*back|round\s*off|change)\b/i;

/** Common date formats on Indian & international receipts. */
export const DATE_PATTERNS: RegExp[] = [
  // 10-JUL-2026 / 10 JUL 2026 (fuel pumps)
  /\b(\d{1,2})[-\s]+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?[-\s,]+(\d{2,4})\b/i,
  // PhonePe: "11:32 AM on 26 Jun 2026"
  /\bon\s+(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(\d{2,4})\b/i,
  /\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b/,
  /\b(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})\b/,
  /\b(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?[,\s]+(\d{2,4})\b/i,
  /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2})[,\s]+(\d{2,4})\b/i,
];

export const DATE_LABEL_PATTERN =
  /\b(date|dt|dated|bill\s*date|invoice\s*date|txn\s*date|transaction\s*date|payment\s*date)\b/i;

/** Invoice / bill / receipt numbers. Prefer INVOICE over TXN. */
export const INVOICE_PATTERNS: RegExp[] = [
  /\b(?:invoice|inv)\s*(?:no|number|#|num)?\s*[:.\-]?\s*([A-Z0-9][A-Z0-9\-\/]{2,})\b/i,
  /\b(?:bill|receipt)\s*(?:no|number|#|num)?\s*[:.\-]?\s*([A-Z0-9][A-Z0-9\-\/]{2,})\b/i,
  /\b(?:ref|reference|order)\s*(?:no|number|#|num)?\s*[:.\-]?\s*([A-Z0-9][A-Z0-9\-\/]{2,})\b/i,
  /\b(?:inv|bill)\s*[-#:]?\s*([A-Z0-9][A-Z0-9\-\/]{2,})\b/i,
];

/** Indian GSTIN (15 chars) + fuel-pump S.T. / M.S.T. tax IDs. */
export const GSTIN_PATTERNS: RegExp[] = [
  /\b(?:gstin|gst\s*in|gst\s*(?:no|number|#)?)\s*[:.\-]?\s*([0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][A-Z0-9]Z[A-Z0-9])\b/i,
  /\b([0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][A-Z0-9]Z[A-Z0-9])\b/i,
];

/** Fuel / older tax registration labels (S.T. No, M.S.T. No, TIN). */
export const TAX_ID_PATTERNS: RegExp[] = [
  /\b(?:s\.?\s*t\.?\s*no|st\s*no|sales\s*tax\s*no)\s*[:.\-]?\s*([0-9]{8,14}[A-Z0-9]?)\b/i,
  /\b(?:m\.?\s*s\.?\s*t\.?\s*no|mst\s*no)\s*[:.\-]?\s*([0-9]{8,14}[A-Z0-9]?)\b/i,
  /\b(?:tin|vat\s*no|cst\s*no)\s*[:.\-]?\s*([0-9]{8,14}[A-Z0-9]?)\b/i,
];

/** UPI / Paytm / GPay / PhonePe payment screenshots. */
export const UPI_PAYMENT_SIGNAL =
  /\b(upi|paytm|phonepe|phone\s*pe|google\s*pay|gpay|g\s*pay|money\s*sent|transaction\s*successful|paid\s*to|debited\s*from|upi\s*ref|upi\s*transaction|utr|completed|google\s*transaction)\b/i;

export const UPI_ID_PATTERN =
  /\b([a-zA-Z0-9][a-zA-Z0-9.\-_]{1,50}@[a-zA-Z][a-zA-Z0-9]{1,20})\b/;

export const UTR_PATTERNS: RegExp[] = [
  /\b(?:utr|unique\s*transaction\s*reference)\s*(?:no|number|#)?\s*[:.\-]?\s*([0-9]{10,22})\b/i,
];

export const UPI_REF_PATTERNS: RegExp[] = [
  /\bupi\s*ref(?:erence)?\s*(?:no|number|#)?\.?\s*[:.\-]?\s*([0-9]{10,22})\b/i,
];

export const UPI_TXN_PATTERNS: RegExp[] = [
  /\bupi\s*transaction\s*(?:id|no|number|#)?\s*[:.\-]?\s*([0-9A-Z]{10,24})\b/i,
  /\bupi\s*txn\s*(?:id|no|number|#)?\s*[:.\-]?\s*([0-9A-Z]{10,24})\b/i,
];

export const APP_TXN_PATTERNS: Array<{ label: string; pattern: RegExp }> = [
  {
    label: 'PhonePe Transaction ID',
    pattern:
      /\bphone\s*pe\s*transaction\s*(?:id|no|number|#)?\s*[:.\-]?\s*([A-Z0-9]{10,40})\b/i,
  },
  {
    label: 'Google Transaction ID',
    pattern:
      /\bgoogle\s*transaction\s*(?:id|no|number|#)?\s*[:.\-]?\s*([A-Za-z0-9\-]{8,40})\b/i,
  },
  {
    label: 'Paytm Transaction ID',
    pattern:
      /\bpaytm\s*transaction\s*(?:id|no|number|#)?\s*[:.\-]?\s*([A-Z0-9]{8,40})\b/i,
  },
];

/** Recipient ("To" / "Paid to") on UPI slips — use as merchant. */
export const UPI_RECIPIENT_PATTERNS: RegExp[] = [
  /\bpaid\s*to\s*[:.\-]?\s*(.+)$/i,
  /\bto\s*[:.\-]\s*(.+)$/i,
  /^to\s+(.+?)(?:\s*\(|$)/i,
];

export const CURRENCY_PATTERNS: Array<{ code: string; pattern: RegExp }> = [
  { code: 'INR', pattern: /(?:₹|\brs\.?\b|\binr\b)/i },
  { code: 'USD', pattern: /(?:\$|\busd\b)/i },
  { code: 'EUR', pattern: /(?:€|\beur\b)/i },
  { code: 'GBP', pattern: /(?:£|\bgbp\b)/i },
  { code: 'AED', pattern: /\baed\b|\bdirham\b/i },
];

/** Noise lines that should not be treated as merchant names. */
export const MERCHANT_SKIP_PATTERN =
  /\b(tax|gst|gstin|tin|invoice|receipt|bill\s*(?:no|amount|amt)|total|amount|cash|card|thank|welcome|phone|tel|www\.|http|address|date|time|qty|qty\.|item|order|token|customer|copy|original|duplicate|vehicle|txn|nozzle|product|density|volume|rate|ph\.|s\.?t\.?\s*no|m\.?s\.?t\.?\s*no|nh\.?\s*\d|road|street|avenue|sector|district|dist|dis|pin\s*code|steward|table|cover|sac|description|state|from|debited|sent\s*via|money\s*sent|transaction\s*successful|completed|upi\s*ref|utr)\b/i;

/** Words that strongly indicate a real business / store name. */
export const MERCHANT_BOOST_PATTERN =
  /\b(hotel|restaurant|palace|cafe|café|resort|dhaba|kitchen|grill|bakery|bakers|pvt|ltd|limited|traders|stores|mart|supermarket|petroleum|petrol|fuels?|pump|station|enterprises|industries|hospital|clinic|pharmacy|medical)\b/i;
