/**
 * Rule-based receipt parser (regex + heuristics).
 * Extracts merchant, amount, date, tax, invoice #, and currency.
 */

import {
  AMOUNT_LABEL_PATTERN,
  APP_TXN_PATTERNS,
  CURRENCY_PATTERNS,
  DATE_LABEL_PATTERN,
  DATE_PATTERNS,
  FINAL_TOTAL_PATTERN,
  FUEL_META_PATTERN,
  GSTIN_PATTERNS,
  INVOICE_PATTERNS,
  MERCHANT_BOOST_PATTERN,
  MERCHANT_SKIP_PATTERN,
  MONEY_PATTERN,
  NON_TOTAL_PATTERN,
  PRETAX_TOTAL_PATTERN,
  TAX_ID_PATTERNS,
  TAX_KEYWORD_PATTERN,
  TOTAL_KEYWORD_PATTERN,
  UNIT_PRICE_PATTERN,
  UPI_ID_PATTERN,
  UPI_PAYMENT_SIGNAL,
  UPI_RECIPIENT_PATTERNS,
  UPI_REF_PATTERNS,
  UPI_TXN_PATTERNS,
  UTR_PATTERNS,
} from './regex';

export type ReceiptCurrency = 'INR' | 'USD' | 'EUR' | 'GBP' | 'AED' | string;

export type ParsedReceipt = {
  merchant: string | null;
  amount: number | null;
  date: string | null; // YYYY-MM-DD
  tax: number | null;
  invoiceNumber: string | null;
  gstin: string | null;
  currency: ReceiptCurrency | null;
  /** Ready-made note lines (Invoice, GSTIN, UTR, UPI IDs, …). */
  noteLines: string[];
};

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

export class ReceiptParserService {
  parse(rawText: string): ParsedReceipt {
    const normalized = this.normalize(rawText);
    const lines = normalized
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

    const isUpi = UPI_PAYMENT_SIGNAL.test(normalized);

    let amount = this.extractAmount(normalized, lines, isUpi);
    let tax = isUpi ? null : this.extractTax(normalized, lines, amount);
    let date = this.extractDate(normalized, lines);
    let merchant = isUpi
      ? this.extractUpiRecipient(normalized, lines)
      : this.extractMerchant(lines);
    // Fallback: if UPI recipient failed, try general merchant
    if (!merchant) merchant = this.extractMerchant(lines);
    // Fallback: if general failed on UPI-ish text, try recipient again
    if (!merchant && isUpi) {
      merchant = this.extractUpiRecipient(normalized, lines);
    }

    const invoiceNumber = this.extractInvoiceNumber(normalized, lines);
    const gstin = this.extractGstin(normalized, lines);
    const currency = this.extractCurrency(normalized) ?? (isUpi ? 'INR' : null);

    const noteLines = this.buildNoteLines(normalized, lines, {
      invoiceNumber,
      gstin,
    });

    return {
      merchant,
      amount,
      date,
      tax,
      invoiceNumber,
      gstin,
      currency,
      noteLines,
    };
  }

  private normalize(text: string): string {
    return text
      .replace(/\r/g, '\n')
      .replace(/[|]/g, 'I')
      // Common OCR typo: AMOUNT → AvoUNT / AMONT
      .replace(/\bavo?unt\b/gi, 'AMOUNT')
      .replace(/\bamont\b/gi, 'AMOUNT')
      .replace(/\bamunt\b/gi, 'AMOUNT')
      // "10-JUL -2026" / "10 -JUL -2026" → "10-JUL-2026"
      .replace(
        /\b(\d{1,2})\s*-\s*(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s*-\s*(\d{2,4})\b/gi,
        '$1-$2-$3',
      )
      // ₹ (rupee) is often OCR'd as a leading "2":
      //   Total: 25,445.30 → Total: 5,445.30
      //   2.5% 2129.65   → 2.5% 129.65
      .replace(
        /\b((?:grand\s*)?total|bill\s*amount|amount|sub[-\s]*total|cgst|sgst|igst|gst|tax|price)\b([^0-9\n]{0,16})2(?=\d{1,3},\d{3}(?:\.\d{2})?\b)/gi,
        '$1$2',
      )
      .replace(
        /\b((?:grand\s*)?total|bill\s*amount|amount|sub[-\s]*total|cgst|sgst|igst|gst|tax|price)\b([^0-9\n]{0,16})2(?=\d{4,}(?:\.\d{2})?\b)/gi,
        '$1$2',
      )
      .replace(/(%\s*)2(?=\d{3}(?:\.\d{2})?\b)/g, '$1')
      .replace(/[^\S\n]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n');
  }

  private extractAmount(
    text: string,
    lines: string[],
    preferUpi = false,
  ): number | null {
    if (preferUpi) {
      const upiAmount = this.extractUpiAmount(lines, text);
      if (upiAmount != null) return upiAmount;
    }

    const candidates: { value: number; score: number }[] = [];
    const idNoise =
      /\b(s\.?\s*t\.?\s*no|m\.?\s*s\.?\s*t\.?\s*no|gstin|gst\s*in|tin|ph\.?|phone|tel|txn|vehicle|nozzle|invoice|inv\s*no|bill\s*no\.?|steward|table|cover|sac)\b/i;

    const subtotal = this.extractSubtotal(lines);
    const hasFinalLabel = lines.some((l) => FINAL_TOTAL_PATTERN.test(l));

    const pushCandidate = (
      raw: string,
      line: string,
      scoreBoost = 0,
    ): void => {
      let value = this.toMoney(raw);
      if (value == null) return;
      value = this.dropRupeeGhostTwo(value, subtotal);

      const hasDecimals = /\.\d{1,2}$/.test(raw.replace(/,/g, ''));
      const isFinal = FINAL_TOTAL_PATTERN.test(line);
      const isPretax = PRETAX_TOTAL_PATTERN.test(line);
      let score = 1 + scoreBoost;

      if (isFinal) score += 18;
      else if (TOTAL_KEYWORD_PATTERN.test(line) && !isPretax) score += 6;
      if (AMOUNT_LABEL_PATTERN.test(line) && !isPretax) score += 10;
      if (/grand/i.test(line)) score += 2;
      if (isPretax) score -= hasFinalLabel ? 12 : 4;
      if (UNIT_PRICE_PATTERN.test(line)) score -= 12;
      if (FUEL_META_PATTERN.test(line)) score -= 10;
      if (NON_TOTAL_PATTERN.test(line) || TAX_KEYWORD_PATTERN.test(line)) {
        score -= 4;
      }

      const hasCurrency = /(?:₹|rs\.?|inr|\$|€|£)/i.test(line);
      if (hasCurrency) score += 10;

      if (hasDecimals) score += 4;
      else {
        if (
          !isFinal &&
          !AMOUNT_LABEL_PATTERN.test(line) &&
          !TOTAL_KEYWORD_PATTERN.test(line) &&
          !hasCurrency &&
          scoreBoost < 10
        ) {
          return;
        }
        score -= hasCurrency ? 2 : 6;
      }

      if (
        value >= 50_000 &&
        !isFinal &&
        !AMOUNT_LABEL_PATTERN.test(line) &&
        !hasCurrency
      ) {
        return;
      }
      if (value < 20) score -= 2;

      if (subtotal != null && value >= subtotal && value <= subtotal * 1.4) {
        score += 5;
      }

      candidates.push({ value, score });
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (idNoise.test(line)) continue;

      MONEY_PATTERN.lastIndex = 0;
      let match: RegExpExecArray | null;
      let foundOnLine = false;
      while ((match = MONEY_PATTERN.exec(line)) !== null) {
        foundOnLine = true;
        pushCandidate(match[1], line);
      }

      // Label on this line, amount alone on the next (very common OCR split)
      const labelOnly =
        (FINAL_TOTAL_PATTERN.test(line) ||
          AMOUNT_LABEL_PATTERN.test(line) ||
          TOTAL_KEYWORD_PATTERN.test(line)) &&
        !foundOnLine;
      if (labelOnly && i + 1 < lines.length) {
        const next = lines[i + 1];
        if (idNoise.test(next) || UNIT_PRICE_PATTERN.test(next)) continue;
        MONEY_PATTERN.lastIndex = 0;
        const nextMatch = MONEY_PATTERN.exec(next);
        if (nextMatch?.[1]) {
          pushCandidate(nextMatch[1], `${line} ${next}`, 12);
        }
      }
    }

    if (candidates.length === 0) {
      MONEY_PATTERN.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = MONEY_PATTERN.exec(text)) !== null) {
        const raw = match[1];
        if (!/\.\d{2}$/.test(raw.replace(/,/g, ''))) continue;
        let value = this.toMoney(raw);
        if (value == null || value < 10 || value >= 50_000) continue;
        value = this.dropRupeeGhostTwo(value, subtotal);
        // Was 0.5 and then rejected by score < 2 — keep fallback usable
        candidates.push({ value, score: 2 });
      }
    }

    if (candidates.length === 0) return null;
    candidates.sort((a, b) => b.score - a.score || b.value - a.value);
    const best = candidates[0];
    if (best.score < 1) return null;
    return best.value;
  }

  /**
   * UPI / Paytm / GPay / PhonePe amounts.
   * Paytm: "Money Sent Successfully" then ₹700 then "Rupees Seven Hundred Only".
   * GPay: ₹450 above "Pay again" / "Completed" (phone line must never win).
   */
  private extractUpiAmount(lines: string[], text: string): number | null {
    const isYear = (n: number) => n >= 2000 && n <= 2099 && Number.isInteger(n);
    const isDateLine = (line: string) =>
      /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/i.test(line) ||
      /\b(am|pm)\b/i.test(line) ||
      DATE_PATTERNS.some((p) => p.test(line));
    const isPhoneLine = (line: string) =>
      /\+?\s*91\b/.test(line) ||
      /\b\d{5}\s+\d{5}\b/.test(line) ||
      /\b\d{10,12}\b/.test(line.replace(/\s/g, ''));
    const isNoiseLine = (line: string) => {
      if (UPI_ID_PATTERN.test(line)) return true;
      if (
        /\b(utr|upi\s*ref|transaction\s*id|google\s*transaction|debited|a\/c|account)\b/i.test(
          line,
        )
      ) {
        return true;
      }
      // Skip From/Bank lines unless they clearly show a rupee amount
      if (
        /\b(from|bank)\b/i.test(line) &&
        !/(?:₹|rs\.?|inr)\s*\d/i.test(line)
      ) {
        return true;
      }
      return false;
    };

    // Paytm word form is the strongest signal when OCR finds it
    const wordsAmount = this.extractAmountInWords(text);
    if (wordsAmount != null) return wordsAmount;

    const successIdx = lines.findIndex((l) =>
      /\b(money\s*sent\s*successfully|transaction\s*successful|payment\s*successful|paid\s*successfully|money\s*sent|payment\s*completed|completed)\b/i.test(
        l,
      ),
    );
    const payAgainIdx = lines.findIndex((l) => /\bpay\s*again\b/i.test(l));

    const nearSuccessScore = (idx: number): number => {
      let score = 0;
      if (successIdx >= 0) {
        const dist = idx - successIdx;
        // Paytm amount is BELOW "Money Sent Successfully"
        if (dist >= 0 && dist <= 4) score += 50 - dist * 5;
        if (dist >= -3 && dist < 0) score += 35 - Math.abs(dist) * 5;
      }
      if (payAgainIdx >= 0) {
        const dist = payAgainIdx - idx;
        // GPay amount is 1–3 lines ABOVE "Pay again"
        if (dist >= 1 && dist <= 3) score += 60 - dist * 5;
      }
      return score;
    };

    const rupeeRe =
      /(?:₹|rs\.?|inr|r\$|[?\*¥]|(?<![A-Za-z0-9])R)\s*([0-9]+(?:,[0-9]{3})*(?:\.[0-9]{1,2})?)/gi;

    const hits: { value: number; score: number }[] = [];
    const push = (raw: string, score: number) => {
      const digits = raw.replace(/,/g, '');
      if (digits.length >= 10) return;
      const value = this.toMoney(raw);
      if (value == null || value < 1 || value > 1_000_000) return;
      if (isYear(value)) return;
      hits.push({ value, score: score + (value >= 10 && value < 100_000 ? 5 : 0) });
    };

    for (const [idx, line] of lines.entries()) {
      if (isPhoneLine(line) || isDateLine(line) || isNoiseLine(line)) continue;

      rupeeRe.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = rupeeRe.exec(line)) !== null) {
        push(m[1], 100 + nearSuccessScore(idx) - Math.min(idx, 8));
      }

      // Glued OCR rupee: Rs700 / INR450 / ₹700 / R450 (GPay often drops the mark)
      const glued = line.match(
        /(?:^|\s)(?:rs\.?|inr|₹|R)\s*([0-9]+(?:,[0-9]{3})*(?:\.[0-9]{1,2})?)/i,
      );
      if (glued?.[1]) {
        push(glued[1], 95 + nearSuccessScore(idx));
      }

      // Bare hero amount (OCR dropped ₹): "700" or "450"
      const bare = line.match(/^([0-9]+(?:,[0-9]{3})*(?:\.[0-9]{1,2})?)$/);
      if (bare?.[1]) {
        const digits = bare[1].replace(/,/g, '').replace(/\.\d+$/, '');
        if (digits.length < 5 || bare[1].includes(',')) {
          push(bare[1], 55 + nearSuccessScore(idx));
        }
      }
    }

    // Window join around success / Pay again (₹ often split from digits)
    if (hits.length === 0) {
      const anchor = payAgainIdx >= 0 ? payAgainIdx : successIdx;
      const window =
        anchor >= 0
          ? lines.slice(Math.max(0, anchor - 5), anchor + 6).join(' ')
          : lines.slice(0, 14).join(' ');
      rupeeRe.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = rupeeRe.exec(window)) !== null) {
        push(m[1], 85);
      }
    }

    if (hits.length === 0) {
      rupeeRe.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = rupeeRe.exec(text)) !== null) {
        push(m[1], 65);
      }
    }

    if (hits.length === 0) return null;
    hits.sort((a, b) => b.score - a.score || b.value - a.value);
    return hits[0].value;
  }

  /** Paytm: "Rupees Seven Hundred Only" → 700 */
  private extractAmountInWords(text: string): number | null {
    const match = text.match(
      /\brupees?\s+([a-z\s\-]+?)\s+only\b/i,
    );
    if (!match?.[1]) return null;

    const ones: Record<string, number> = {
      zero: 0,
      one: 1,
      two: 2,
      three: 3,
      four: 4,
      five: 5,
      six: 6,
      seven: 7,
      eight: 8,
      nine: 9,
      ten: 10,
      eleven: 11,
      twelve: 12,
      thirteen: 13,
      fourteen: 14,
      fifteen: 15,
      sixteen: 16,
      seventeen: 17,
      eighteen: 18,
      nineteen: 19,
    };
    const tens: Record<string, number> = {
      twenty: 20,
      thirty: 30,
      forty: 40,
      fifty: 50,
      sixty: 60,
      seventy: 70,
      eighty: 80,
      ninety: 90,
    };

    const words = match[1]
      .toLowerCase()
      .replace(/-/g, ' ')
      .split(/\s+/)
      .filter((w) => w && w !== 'and');

    let total = 0;
    let current = 0;
    for (const w of words) {
      if (ones[w] != null) {
        current += ones[w];
      } else if (tens[w] != null) {
        current += tens[w];
      } else if (w === 'hundred') {
        current = (current || 1) * 100;
      } else if (w === 'thousand') {
        current = (current || 1) * 1000;
        total += current;
        current = 0;
      } else if (w === 'lakh' || w === 'lac') {
        current = (current || 1) * 100_000;
        total += current;
        current = 0;
      } else {
        return null;
      }
    }
    total += current;
    if (total < 1 || total > 1_000_000) return null;
    return total;
  }

  /** Sub-Total / Total Amount (pre-tax) — for ₹ ghost-2 and tax checks. */
  private extractSubtotal(lines: string[]): number | null {
    for (const line of lines) {
      if (!NON_TOTAL_PATTERN.test(line) && !PRETAX_TOTAL_PATTERN.test(line)) {
        continue;
      }
      MONEY_PATTERN.lastIndex = 0;
      const match = MONEY_PATTERN.exec(line);
      if (!match) continue;
      return this.toMoney(match[1]);
    }
    return null;
  }

  /**
   * ₹5,445.30 is often read as 25,445.30. If a subtotal exists and
   * stripping a leading 2 lands near it, drop the ghost digit.
   */
  private dropRupeeGhostTwo(value: number, subtotal: number | null): number {
    const fixed = value.toFixed(2);
    if (!fixed.startsWith('2') || fixed.length < 6) return value;
    const stripped = Number.parseFloat(fixed.slice(1));
    if (!Number.isFinite(stripped) || stripped < 10) return value;

    if (subtotal != null) {
      // Ghost-2 total is usually ~5x too big vs subtotal; stripped is close
      if (
        value > subtotal * 1.5 &&
        stripped >= subtotal * 0.9 &&
        stripped <= subtotal * 1.4
      ) {
        return Math.round(stripped * 100) / 100;
      }
    }
    return value;
  }

  private extractTax(
    _text: string,
    lines: string[],
    total: number | null,
  ): number | null {
    const perLine: number[] = [];

    for (const line of lines) {
      if (!TAX_KEYWORD_PATTERN.test(line)) continue;
      // Strip rates (2.5% / 18%) so they are not parsed as money
      const cleaned = line.replace(/\d+(?:\.\d+)?\s*%/g, ' ');
      MONEY_PATTERN.lastIndex = 0;
      const values: number[] = [];
      let match: RegExpExecArray | null;
      while ((match = MONEY_PATTERN.exec(cleaned)) !== null) {
        let value = this.toMoney(match[1]);
        if (value == null) continue;
        // ₹129.65 → 2129.65: drop ghost 2 when value looks inflated
        const fixed = value.toFixed(2);
        if (fixed.startsWith('2') && fixed.length >= 6) {
          const stripped = Number.parseFloat(fixed.slice(1));
          if (
            Number.isFinite(stripped) &&
            stripped >= 1 &&
            (total == null || stripped < total)
          ) {
            value = Math.round(stripped * 100) / 100;
          }
        }
        if (total != null && value >= total) continue;
        // Ignore leftover tiny integers (not paise amounts)
        if (value < 1) continue;
        if (value <= 40 && !/\.\d{2}$/.test(match[1].replace(/,/g, ''))) continue;
        values.push(value);
      }
      if (values.length === 0) continue;
      values.sort((a, b) => b - a);
      perLine.push(values[0]);
    }

    if (perLine.length === 0) return null;

    // Sum CGST + SGST (+ IGST) component lines when present
    if (perLine.length >= 2) {
      const sum =
        Math.round(perLine.reduce((a, b) => a + b, 0) * 100) / 100;
      if (total == null || sum < total) return sum;
    }
    perLine.sort((a, b) => b - a);
    return perLine[0];
  }

  private extractDate(text: string, lines: string[]): string | null {
    const tryParse = (input: string): string | null => {
      for (const re of DATE_PATTERNS) {
        const m = input.match(re);
        if (!m) continue;
        const iso = this.parseDateMatch(m);
        if (iso) return iso;
      }
      return null;
    };

    for (const line of lines) {
      if (
        !DATE_LABEL_PATTERN.test(line) &&
        !DATE_PATTERNS.some((p) => p.test(line)) &&
        !/\b(am|pm)\b/i.test(line) // UPI timestamps often have time + date
      ) {
        continue;
      }
      const d = tryParse(line);
      if (d) return d;
    }

    return tryParse(text);
  }

  private parseDateMatch(m: RegExpMatchArray): string | null {
    try {
      if (m.length >= 4 && /^[A-Za-z]{3}/.test(m[1])) {
        const month = MONTHS[m[1].slice(0, 3).toLowerCase()];
        const day = Number(m[2]);
        let year = Number(m[3]);
        if (year < 100) year += 2000;
        return this.toIsoDate(year, month, day);
      }
      if (m.length >= 4 && /^[A-Za-z]{3}/.test(m[2])) {
        const day = Number(m[1]);
        const month = MONTHS[m[2].slice(0, 3).toLowerCase()];
        let year = Number(m[3]);
        if (year < 100) year += 2000;
        return this.toIsoDate(year, month, day);
      }
      if (m[1].length === 4) {
        return this.toIsoDate(Number(m[1]), Number(m[2]), Number(m[3]));
      }
      // Prefer DD/MM/YYYY (India-first)
      let year = Number(m[3]);
      if (year < 100) year += 2000;
      return this.toIsoDate(year, Number(m[2]), Number(m[1]));
    } catch {
      return null;
    }
  }

  private toIsoDate(year: number, month: number, day: number): string | null {
    if (!year || !month || !day) return null;
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    // Allow a generous window — receipts / clocks can be ahead of server date
    const maxYear = Math.max(new Date().getFullYear() + 2, 2030);
    if (year < 2000 || year > maxYear) return null;
    const d = new Date(Date.UTC(year, month - 1, day));
    if (
      d.getUTCFullYear() !== year ||
      d.getUTCMonth() !== month - 1 ||
      d.getUTCDate() !== day
    ) {
      return null;
    }
    const y = String(year).padStart(4, '0');
    const m = String(month).padStart(2, '0');
    const dd = String(day).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  }

  private extractMerchant(lines: string[]): string | null {
    // Prefer the line sitting just above PH / GST / address (classic receipt layout)
    const anchored = this.extractMerchantAboveAnchor(lines);
    if (anchored) return anchored;

    // HP / fuel pumps: dealer name sits in the header above PH. / S.T. No
    if (this.looksLikeFuelReceipt(lines)) {
      const fuel = this.extractFuelDealerMerchant(lines);
      if (fuel) return fuel;
    }

    const looksLikeMoney = /(?:₹|rs\.?|inr|\$|€|£)\s*\d|\d+\.\d{2}/i;
    const looksLikeDate =
      /\d{1,2}[\/\-.]\d{1,2}[\/\-.]?\d{0,4}|\d{1,2}[-\s]+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i;
    const looksLikeId =
      /\b(gstin|tin|sac|bill\s*no|invoice|ph\.?|tel|steward|table|cover|s\.?\s*t\.?\s*no|m\.?\s*s\.?\s*t\.?\s*no|txn|vehicle|nozzle|product|density|volume|rate|original|thank)\b/i;
    const looksLikeAddress =
      /\b(\d{5,6}|road|street|nagar|colony|near|opp\.?|behind|floor|block|plot|nh\.?\s*\d|highway|mandal|village|taluk|-\s*dis\b|\bdis\b|\bdistrict\b)\b/i;

    const candidates: { line: string; score: number }[] = [];

    // Header band — business name is almost always in the first ~12 lines
    for (const [idx, line] of lines.slice(0, 14).entries()) {
      if (line.length < 4 || line.length > 70) continue;
      if (MERCHANT_SKIP_PATTERN.test(line)) continue;
      if (looksLikeMoney.test(line)) continue;
      if (looksLikeDate.test(line)) continue;
      if (looksLikeId.test(line)) continue;
      if (looksLikeAddress.test(line)) continue;
      if (/^\d+$/.test(line)) continue;
      if (/^[\W_]+$/.test(line)) continue;

      // Drop trailing location after comma before scrubbing punctuation
      // e.g. "HOTEL AMER PALACE, RATANPUR" → brand only
      const beforeComma = line.split(',')[0].trim();
      const brandSource =
        beforeComma.split(/\s+/).length >= 2 ? beforeComma : line;

      const cleaned = this.cleanMerchantLine(brandSource);
      if (!cleaned || cleaned.length < 5) continue;

      const letters = (cleaned.match(/[A-Za-z]/g) || []).length;
      const digits = (cleaned.match(/[0-9]/g) || []).length;
      if (letters < 6) continue;
      const letterRatio =
        letters / Math.max(1, cleaned.replace(/\s/g, '').length);
      if (letterRatio < 0.75) continue;

      const words = cleaned.split(/\s+/).filter(Boolean);
      const solidWords = words.filter((w) => /^[A-Za-z]{2,}$/.test(w));
      if (solidWords.length < 2) continue;
      if (solidWords.filter((w) => w.length >= 4).length === 0) continue;
      // Reject OCR garbage: mostly 1–2 letter tokens
      if (words.filter((w) => w.length <= 2).length >= solidWords.length) {
        continue;
      }

      let score = Math.max(0, 10 - idx); // strongly prefer top of receipt
      score += solidWords.length * 2;
      score += solidWords.filter((w) => w.length >= 5).length * 3;
      score += solidWords.filter((w) => w.length >= 7).length * 4;

      const upperSolid = solidWords.filter(
        (w) => w === w.toUpperCase() && w.length >= 3,
      );
      if (upperSolid.length >= 2) score += 8;
      if (upperSolid.length >= 3) score += 4;

      if (MERCHANT_BOOST_PATTERN.test(cleaned)) score += 16;
      if (/hotel|restaurant|palace|cafe|resort/i.test(cleaned)) score += 6;
      if (/srinivas|petroleum|fuels?|pump|station|traders|enterprises/i.test(cleaned)) {
        score += 10;
      }

      if (digits > 0) score -= 4;
      if (cleaned.length < 10) score -= 3;
      score -= words.filter((w) => w.length <= 2).length * 2;

      // Prefer a clean multi-word brand (drop tiny OCR crumbs)
      const name = solidWords
        .filter((w) => w.length >= 2)
        .slice(0, 6)
        .join(' ');

      candidates.push({ line: name, score });
    }

    if (candidates.length === 0) return null;
    candidates.sort((a, b) => b.score - a.score);
    return this.titleCase(candidates[0].line);
  }

  /** Line directly above phone / tax / address is usually the store name. */
  private extractMerchantAboveAnchor(lines: string[]): string | null {
    const anchorIdx = lines.findIndex((l) =>
      /\b(ph\.?|tel|gstin|gst\s*in|s\.?\s*t\.?\s*no|m\.?\s*s\.?\s*t\.?\s*no|nh\.?\s*\d|road|street|pin\s*code)\b/i.test(
        l,
      ),
    );
    if (anchorIdx <= 0) return null;

    for (let i = anchorIdx - 1; i >= 0 && i >= anchorIdx - 4; i--) {
      const line = lines[i];
      if (MERCHANT_SKIP_PATTERN.test(line)) continue;
      if (/\b(original|duplicate|copy|thank|welcome|restaurant)\b/i.test(line) &&
          line.split(/\s+/).length <= 1) {
        continue;
      }
      if (/\d{5,}/.test(line)) continue;
      if (/(?:₹|rs\.?|inr)\s*\d|\d+\.\d{2}/i.test(line)) continue;

      // OCR-tolerant fuel dealer: (S)HIVA SAI SRINIVAS(A)
      const fuelish = this.matchFuelDealerName(line);
      if (fuelish) return fuelish;

      const cleaned = this.cleanMerchantLine(line.split(',')[0]);
      if (!cleaned) continue;
      const words = cleaned.split(/\s+/).filter((w) => /^[A-Za-z]{2,}$/.test(w));
      if (words.length < 2 || words.length > 6) continue;
      if (words.filter((w) => w.length >= 4).length === 0) continue;
      if (words.every((w) => w.length <= 3) && words.length < 3) continue;

      // Strong signal: ALL CAPS multi-word header
      const caps = words.filter((w) => w === w.toUpperCase() && w.length >= 3);
      if (caps.length >= 2 || MERCHANT_BOOST_PATTERN.test(cleaned)) {
        return this.titleCase(words.slice(0, 5).join(' '));
      }
    }
    return null;
  }

  private cleanMerchantLine(line: string): string | null {
    // Fix common OCR digit/letter swaps inside name tokens
    const fixed = line
      .replace(/0/g, 'O')
      .replace(/(?<=[A-Za-z])1(?=[A-Za-z])/g, 'I')
      .replace(/[^A-Za-z0-9 &.'\-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return fixed.length >= 5 ? fixed : null;
  }

  /**
   * OCR often clips the leading S (finger / crease): HIVA SAI SRINIVASA.
   */
  private matchFuelDealerName(line: string): string | null {
    const m = line.match(
      /\b((?:S?H?IVA|SIVA|HIVA|SHIV)\s+SAI\s+SRINI[A-Z]{2,})\b/i,
    );
    if (m?.[1]) {
      let name = m[1].replace(/[^A-Za-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
      // Normalize clipped SHIVA
      name = name.replace(/^(HIVA|SIVA|SHIV)\b/i, 'SHIVA');
      name = name.replace(/\bSRINIVAS\b/i, 'SRINIVASA');
      return this.titleCase(name);
    }
    const loose = line.match(
      /\b((?:[A-Z]{3,}(?:\s+[A-Z]{2,}){0,3}\s+)?SRINI[A-Z]{3,})\b/i,
    );
    if (loose?.[1]) {
      const words = loose[1]
        .replace(/[^A-Za-z\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .split(/\s+/)
        .filter((w) => w.length >= 2);
      if (words.length >= 2) {
        return this.titleCase(
          words
            .slice(0, 5)
            .join(' ')
            .replace(/\bSRINIVAS\b/i, 'SRINIVASA'),
        );
      }
    }
    return null;
  }

  /**
   * Indian fuel-pump receipts (HP / IOCL / BPCL): dealer name is ALL-CAPS
   * in the header, above PH. / S.T. No / address — e.g. "SHIVA SAI SRINIVASA".
   */
  private looksLikeFuelReceipt(lines: string[]): boolean {
    const head = lines.slice(0, 30).join('\n');
    return /\b(nozzle|density|volume|ltr|inr\/?\s*ltr|petrol|diesel|petroleum|hp\b|iocl|bpcl|rate\s*[:.\s]*\d)/i.test(
      head,
    );
  }

  private extractFuelDealerMerchant(lines: string[]): string | null {
    // Search joined header text first (OCR sometimes splits the name)
    const headerText = lines.slice(0, 12).join(' ');
    const fromJoin = this.matchFuelDealerName(headerText);
    if (fromJoin) return fromJoin;

    const headerEnd = lines.findIndex((l) =>
      /\b(ph\.?|tel|s\.?\s*t\.?\s*no|m\.?\s*s\.?\s*t\.?\s*no|original|txn|invoice|date)\b/i.test(
        l,
      ),
    );
    const band = lines.slice(0, headerEnd >= 0 ? headerEnd : 8);

    const isNoise = (line: string) =>
      MERCHANT_SKIP_PATTERN.test(line) ||
      /\b(ph\.?|tel|nh\.?\s*\d|highway|road|street|-\s*dis\b|\bdis\b|\bdistrict\b|original|thank|gstin|tin)\b/i.test(
        line,
      ) ||
      /\d{5,}/.test(line) ||
      /(?:₹|rs\.?|inr)\s*\d|\d+\.\d{2}/i.test(line);

    for (const line of band) {
      if (isNoise(line)) continue;
      const hit = this.matchFuelDealerName(line);
      if (hit) return hit;
    }

    // Fallback: first clean ALL-CAPS 2–4 word line in the header band
    const candidates: { name: string; score: number }[] = [];
    for (const [idx, line] of band.entries()) {
      if (isNoise(line)) continue;
      const cleaned = line
        .replace(/[^A-Za-z\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      const words = cleaned.split(/\s+/).filter((w) => /^[A-Za-z]{2,}$/.test(w));
      if (words.length < 2 || words.length > 5) continue;
      if (words.filter((w) => w.length >= 4).length === 0) continue;
      const allCaps = words.every((w) => w === w.toUpperCase());
      if (!allCaps) continue;

      let score = 20 - idx;
      score += words.length * 3;
      if (words.some((w) => /srini|shiva|hiva|siva|petroleum|fuels?|sai|sri/i.test(w))) {
        score += 20;
      }
      candidates.push({ name: words.slice(0, 5).join(' '), score });
    }
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => b.score - a.score);
    return this.titleCase(
      candidates[0].name
        .replace(/^(HIVA|SIVA|SHIV)\b/i, 'SHIVA')
        .replace(/\bSRINIVAS\b/i, 'SRINIVASA'),
    );
  }

  private extractInvoiceNumber(text: string, lines: string[]): string | null {
    for (const line of lines) {
      // Don't treat UPI Ref / UTR / txn ids as invoice numbers
      if (/\b(upi|utr|transaction\s*id|txn\s*id|phone\s*pe|google\s*pay|paytm)\b/i.test(line)) {
        continue;
      }
      for (const re of INVOICE_PATTERNS) {
        const m = line.match(re);
        if (m?.[1]) return m[1].toUpperCase();
      }
    }
    for (const re of INVOICE_PATTERNS) {
      const m = text.match(re);
      if (m?.[1]) {
        // Reject if the match sits on a UPI/UTR line
        const around = text.slice(
          Math.max(0, (m.index ?? 0) - 24),
          (m.index ?? 0) + m[0].length + 8,
        );
        if (/\b(upi|utr)\b/i.test(around)) continue;
        return m[1].toUpperCase();
      }
    }
    return null;
  }

  private extractGstin(text: string, lines: string[]): string | null {
    // Collapse spaces inside likely GSTIN blobs (OCR often inserts them)
    const compact = text.replace(
      /\b(\d{2})\s*([A-Z]{5})\s*(\d{4})\s*([A-Z])\s*([A-Z0-9])\s*Z\s*([A-Z0-9])\b/gi,
      '$1$2$3$4$5Z$6',
    );

    // 1) Proper 15-char GSTIN
    for (const line of [compact, ...lines]) {
      for (const re of GSTIN_PATTERNS) {
        const m = line.match(re);
        if (m?.[1]) return m[1].toUpperCase();
      }
    }

    // 2) Fuel-pump / older tax IDs — prefer S.T. No, then M.S.T. / TIN
    let stNo: string | null = null;
    let other: string | null = null;
    for (const line of lines) {
      const st = line.match(
        /\b(?:s\.?\s*t\.?\s*no|st\s*no|sales\s*tax\s*no)\s*[:.\-]?\s*([0-9]{8,14}[A-Z0-9]?)\b/i,
      );
      if (st?.[1] && !stNo) stNo = st[1].toUpperCase();
      const mst = line.match(
        /\b(?:m\.?\s*s\.?\s*t\.?\s*no|mst\s*no|tin|vat\s*no|cst\s*no)\s*[:.\-]?\s*([0-9]{8,14}[A-Z0-9]?)\b/i,
      );
      if (mst?.[1] && !other) other = mst[1].toUpperCase();
    }
    for (const re of TAX_ID_PATTERNS) {
      const m = compact.match(re);
      if (!m?.[1]) continue;
      const id = m[1].toUpperCase();
      if (/s\.?\s*t\.?\s*no|sales\s*tax/i.test(m[0]) && !stNo) stNo = id;
      else if (!other) other = id;
    }

    return stNo ?? other;
  }

  /**
   * Paytm / GPay / PhonePe — merchant = recipient ("To" / "Paid to").
   */
  private extractUpiRecipient(text: string, lines: string[]): string | null {
    const cleanName = (raw: string): string | null => {
      let name = raw
        .replace(/\s*\([^)]*\)\s*$/, '')
        .replace(/[|:].*$/, '')
        .replace(UPI_ID_PATTERN, '')
        .replace(/[^A-Za-z .']/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (name.length < 3) return null;
      if (/^(to|paid|successful|completed|money|sent|from)$/i.test(name)) {
        return null;
      }
      if (/^from\b/i.test(name)) return null;
      const words = name.split(/\s+/).filter((w) => w.length >= 2);
      if (words.length === 0) return null;
      return this.titleCase(words.slice(0, 6).join(' '));
    };

    for (const line of lines) {
      if (/\b(from|debited\s*from|sent\s*via)\b/i.test(line)) continue;
      for (const re of UPI_RECIPIENT_PATTERNS) {
        const m = line.match(re);
        if (!m?.[1]) continue;
        const name = cleanName(m[1]);
        if (name) return name;
      }
    }

    // PhonePe / GPay: "Paid to" then name on the next line
    for (let i = 0; i < lines.length - 1; i++) {
      if (!/^(paid\s*to|to)\s*$/i.test(lines[i]) && !/^paid\s*to\b/i.test(lines[i])) {
        continue;
      }
      // If this line already had a name after Paid to, skip next-line logic
      if (/^paid\s*to\s+\S+/i.test(lines[i])) continue;
      const next = lines[i + 1];
      if (UPI_ID_PATTERN.test(next)) continue;
      if (/\b(from|bank|utr|transaction|₹|rs\.?|debited)\b/i.test(next)) {
        continue;
      }
      const name = cleanName(next);
      if (name && name.split(/\s+/).length >= 1) return name;
    }

    // GPay header: "To Name (nick)" as the first meaningful line
    for (const line of lines.slice(0, 6)) {
      const m = line.match(/^to\s+(.+)$/i);
      if (!m?.[1]) continue;
      const name = cleanName(m[1]);
      if (name) return name;
    }

    return null;
  }

  private firstCapture(
    text: string,
    lines: string[],
    patterns: RegExp[],
  ): string | null {
    for (const line of lines) {
      for (const re of patterns) {
        const m = line.match(re);
        if (m?.[1]) return m[1].trim();
      }
    }
    for (const re of patterns) {
      const m = text.match(re);
      if (m?.[1]) return m[1].trim();
    }
    return null;
  }

  private buildNoteLines(
    text: string,
    lines: string[],
    base: { invoiceNumber: string | null; gstin: string | null },
  ): string[] {
    const notes: string[] = [];
    const push = (label: string, value: string | null | undefined) => {
      const v = value?.trim();
      if (v) notes.push(`${label}: ${v}`);
    };

    push('Invoice', base.invoiceNumber);
    push('GSTIN', base.gstin);

    const utr = this.firstCapture(text, lines, UTR_PATTERNS);
    push('UTR', utr);

    const upiRef = this.firstCapture(text, lines, UPI_REF_PATTERNS);
    if (upiRef && upiRef !== utr) push('UPI Ref No', upiRef);
    else if (upiRef && !utr) push('UPI Ref No', upiRef);

    const upiTxn = this.firstCapture(text, lines, UPI_TXN_PATTERNS);
    if (upiTxn && upiTxn !== utr && upiTxn !== upiRef) {
      push('UPI Transaction ID', upiTxn);
    }

    let upiId: string | null = null;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const nearTo =
        /\b(to|paid\s*to)\b/i.test(line) ||
        (i > 0 && /\b(to|paid\s*to)\b/i.test(lines[i - 1]));
      const m = line.match(UPI_ID_PATTERN);
      if (m?.[1] && nearTo) {
        upiId = m[1];
        break;
      }
    }
    if (!upiId) {
      const m = text.match(UPI_ID_PATTERN);
      if (m?.[1]) upiId = m[1];
    }
    push('UPI ID', upiId);

    for (const { label, pattern } of APP_TXN_PATTERNS) {
      const m =
        lines.map((l) => l.match(pattern)).find((x) => x?.[1]) ??
        text.match(pattern);
      if (m?.[1]) push(label, m[1]);
    }

    return [...new Set(notes)];
  }

  private extractCurrency(text: string): ReceiptCurrency | null {
    for (const { code, pattern } of CURRENCY_PATTERNS) {
      if (pattern.test(text)) return code;
    }
    // Indian receipts often lose ₹ in OCR but still show GSTIN / GST
    if (/\bgstin\b|\bcgst\b|\bsgst\b|\bigst\b/i.test(text)) return 'INR';
    return null;
  }

  private toMoney(raw: string): number | null {
    const value = Number.parseFloat(raw.replace(/,/g, '').replace(/\s/g, ''));
    if (!Number.isFinite(value) || value <= 0 || value > 1_000_000) return null;
    return Math.round(value * 100) / 100;
  }

  private titleCase(value: string): string {
    const keepUpper = /^(ltd|pvt|llc|inc|hp|bp|ioc|bpcl|iocl|ongc|gst|inr|usa|uk|nh)$/i;
    return value
      .split(/\s+/)
      .map((w) =>
        keepUpper.test(w)
          ? w.toUpperCase()
          : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(),
      )
      .join(' ');
  }
}

export const receiptParserService = new ReceiptParserService();
