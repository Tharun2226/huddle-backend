/**
 * Receipt OCR — Tesseract.js + sharp preprocess + rule-based parser.
 * Lives inside huddle-backend (no separate Next.js scanner).
 */

import { Injectable, Logger } from '@nestjs/common';
import sharp from 'sharp';
import { createWorker, PSM } from 'tesseract.js';
import {
  ReceiptParserService,
  type ParsedReceipt,
} from './receipt/receipt-parser';

export type ReceiptScanResult = ParsedReceipt & {
  category: string | null;
  confidence: number | null; // 0–100 OCR confidence
  riskScore: number;
  riskLevel: 'Low Risk' | 'Medium Risk' | 'High Risk';
  issues: Array<{ code: string; message: string; points: number }>;
  rawText: string;
};

function receiptSignal(text: string, confidence: number): number {
  let score = confidence;
  const checks: Array<[RegExp, number]> = [
    [/\bamount\b/i, 25],
    [/\binvoice\b/i, 12],
    [/\btotal\b/i, 15],
    [/\brate\b/i, 6],
    [/(?:₹|rs\.?|\binr\b|¥|R)\s*\d{1,3}(?:,\d{3})*(?:\.\d{2})?/i, 45],
    [/\brupees?\s+[a-z]/i, 40],
    [/\b(upi|paytm|phonepe|paid\s*to|money\s*sent|utr|completed|pay\s*again|g\s*pay|google\s*pay)\b/i, 20],
    [/\b\d{1,2}[-/\s]+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i, 18],
    [/\d+\.\d{2}\b/, 8],
  ];
  for (const [re, pts] of checks) {
    if (re.test(text)) score += pts;
  }
  if (
    /\bamount\b/i.test(text) &&
    /\b\d{1,2}[-/\s]+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(
      text,
    )
  ) {
    score += 35;
  }
  if (text.replace(/\s/g, '').length < 40) score -= 40;
  // Prefer OCR passes that captured both money and a date (UPI slips)
  const hasMoney =
    /(?:₹|rs\.?|¥|R)\s*\d{2,}/i.test(text) || /\brupees?\s+[a-z]/i.test(text);
  const hasDate =
    /\b\d{1,2}[-/\s,]+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(
      text,
    );
  if (hasMoney && hasDate) score += 30;
  return score;
}

function riskLevelFromScore(
  score: number,
): 'Low Risk' | 'Medium Risk' | 'High Risk' {
  if (score >= 50) return 'High Risk';
  if (score >= 25) return 'Medium Risk';
  return 'Low Risk';
}

@Injectable()
export class ReceiptOcrService {
  private readonly logger = new Logger(ReceiptOcrService.name);
  private readonly parser = new ReceiptParserService();

  /**
   * OCR + parse. Null fields mean uncertain — never invents values.
   */
  async scan(buffer: Buffer): Promise<ReceiptScanResult> {
    const ocr = await this.recognizeImage(buffer);
    const parsed = this.parser.parse(ocr.rawText);
    const category = this.guessCategory(ocr.rawText, parsed.merchant);
    const { issues, riskScore, riskLevel } = this.scoreRisk(
      parsed,
      ocr.confidence,
    );

    return {
      ...parsed,
      category,
      confidence: ocr.confidence,
      riskScore,
      riskLevel,
      issues,
      rawText: ocr.rawText.slice(0, 8000),
    };
  }

  private scoreRisk(
    parsed: ParsedReceipt,
    ocrConfidence: number | null,
  ): {
    issues: Array<{ code: string; message: string; points: number }>;
    riskScore: number;
    riskLevel: 'Low Risk' | 'Medium Risk' | 'High Risk';
  } {
    const issues: Array<{ code: string; message: string; points: number }> = [];

    if (!parsed.merchant?.trim()) {
      issues.push({
        code: 'MISSING_MERCHANT',
        message: 'Merchant name could not be extracted.',
        points: 20,
      });
    }
    if (parsed.amount == null || !(parsed.amount > 0)) {
      issues.push({
        code: 'MISSING_AMOUNT',
        message: 'Total amount is missing or not greater than zero.',
        points: 20,
      });
    }
    if (!parsed.date) {
      issues.push({
        code: 'MISSING_DATE',
        message: 'Receipt date could not be extracted.',
        points: 20,
      });
    }
    if (ocrConfidence != null && ocrConfidence < 55) {
      issues.push({
        code: 'LOW_OCR_CONFIDENCE',
        message: `OCR confidence is low (${ocrConfidence.toFixed(0)}%).`,
        points: 15,
      });
    }

    const riskScore = issues.reduce((sum, i) => sum + i.points, 0);
    return {
      issues,
      riskScore,
      riskLevel: riskLevelFromScore(riskScore),
    };
  }

  private async buildVariants(buffer: Buffer): Promise<Buffer[]> {
    const variants: Buffer[] = [];
    try {
      const meta = await sharp(buffer).metadata();
      const width = meta.width ?? 0;
      const height = meta.height ?? 0;
      const targetWidth =
        width > 0 && width < 1400
          ? Math.min(1800, Math.round(width * 1.8))
          : Math.min(width || 1600, 2000);

      variants.push(
        await sharp(buffer)
          .rotate()
          .resize({ width: targetWidth, fit: 'inside' })
          .grayscale()
          .normalize()
          .png()
          .toBuffer(),
      );

      // Dark UIs (GPay): invert so white ₹ amount becomes dark on white
      variants.push(
        await sharp(buffer)
          .rotate()
          .resize({ width: targetWidth, fit: 'inside' })
          .grayscale()
          .negate({ alpha: false })
          .normalize()
          .linear(1.35, -20)
          .png()
          .toBuffer(),
      );

      // Upper band where UPI hero amount usually sits
      if (width > 200 && height > 200) {
        const topH = Math.round(height * 0.55);
        variants.push(
          await sharp(buffer)
            .rotate()
            .extract({
              left: 0,
              top: 0,
              width,
              height: Math.max(120, topH),
            })
            .resize({ width: Math.min(1800, Math.max(width, 1200)) })
            .grayscale()
            .negate({ alpha: false })
            .normalize()
            .sharpen({ sigma: 1.2 })
            .png()
            .toBuffer(),
        );

        const left = Math.round(width * 0.1);
        const top = Math.round(height * 0.06);
        const cropW = Math.round(width * 0.8);
        const cropH = Math.round(height * 0.88);
        variants.push(
          await sharp(buffer)
            .rotate()
            .extract({ left, top, width: cropW, height: cropH })
            .resize({ width: Math.min(1600, cropW) })
            .grayscale()
            .normalize()
            .png()
            .toBuffer(),
        );
      }

      variants.push(
        await sharp(buffer)
          .rotate()
          .resize({ width: targetWidth, fit: 'inside' })
          .grayscale()
          .normalize()
          .linear(1.2, -15)
          .sharpen({ sigma: 1 })
          .png()
          .toBuffer(),
      );
    } catch (err) {
      this.logger.warn(`Image preprocess failed: ${err}`);
    }

    if (variants.length === 0) variants.push(buffer);
    return variants;
  }

  private async recognizeOnce(
    buffer: Buffer,
    psm: PSM,
  ): Promise<{ text: string; confidence: number }> {
    const worker = await createWorker('eng', 1, {
      logger: () => undefined,
      // Vercel filesystem is read-only except /tmp — tessdata must land there.
      ...(process.env.VERCEL
        ? { cachePath: '/tmp/tessdata', gzip: true }
        : {}),
    });
    try {
      await worker.setParameters({
        tessedit_pageseg_mode: psm,
        preserve_interword_spaces: '1',
      });
      const {
        data: { text, confidence },
      } = await worker.recognize(buffer);
      return {
        text: text || '',
        confidence:
          typeof confidence === 'number' && Number.isFinite(confidence)
            ? confidence
            : 0,
      };
    } finally {
      await worker.terminate().catch((err) => {
        this.logger.warn(`OCR worker terminate failed: ${err}`);
      });
    }
  }

  private async recognizeImage(
    buffer: Buffer,
  ): Promise<{ rawText: string; confidence: number | null }> {
    const variants = await this.buildVariants(buffer);
    let best: { text: string; confidence: number; signal: number } | null =
      null;

    const attempts: Array<{ buf: Buffer; psm: PSM }> = [];
    // Prefer sparse text first — catches GPay "R450" that block mode misses
    if (variants[1]) attempts.push({ buf: variants[1], psm: PSM.SPARSE_TEXT });
    if (variants[2]) attempts.push({ buf: variants[2], psm: PSM.SPARSE_TEXT });
    if (variants[0]) attempts.push({ buf: variants[0], psm: PSM.SPARSE_TEXT });
    for (const v of variants) {
      attempts.push({ buf: v, psm: PSM.SINGLE_BLOCK });
    }

    // Serverless: fewer OCR passes to stay under time/memory limits.
    const limited = process.env.VERCEL ? attempts.slice(0, 2) : attempts;

    for (const attempt of limited) {
      try {
        const result = await this.recognizeOnce(attempt.buf, attempt.psm);
        const signal = receiptSignal(result.text, result.confidence);
        if (!best || signal > best.signal) {
          best = { ...result, signal };
        }
        // Strong UPI amount hit — stop early
        if (
          (/(?:₹|rs\.?|¥|R)\s*\d{2,}/i.test(result.text) ||
            /\brupees?\s+[a-z]+/i.test(result.text)) &&
          result.confidence >= 35
        ) {
          break;
        }
        if (
          /\bamount\b/i.test(result.text) &&
          /\d+\.\d{2}/.test(result.text) &&
          /\b\d{1,2}[-/\s]+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(
            result.text,
          ) &&
          result.confidence >= 40
        ) {
          break;
        }
      } catch (err) {
        this.logger.warn(`OCR attempt failed: ${err}`);
      }
    }

    if (!best) {
      return { rawText: '', confidence: 0 };
    }

    return {
      rawText: best.text,
      confidence: Math.max(0, Math.min(100, best.confidence)),
    };
  }

  private guessCategory(
    text: string,
    merchant: string | null,
  ): string | null {
    const hay = `${merchant ?? ''} ${text}`.toLowerCase();
    if (
      /\b(fuel|petrol|diesel|hp|iocl|bpcl|shell|pump|ltr|litre)\b/.test(hay)
    ) {
      return 'travel';
    }
    if (
      /\b(hotel|stay|inn|resort|airbnb|lodging)\b/.test(hay)
    ) {
      return 'accommodation';
    }
    if (
      /\b(restaurant|cafe|coffee|dosa|meal|food|dining|swiggy|zomato)\b/.test(
        hay,
      )
    ) {
      return 'meals';
    }
    if (/\b(uber|ola|taxi|flight|train|bus|travel)\b/.test(hay)) {
      return 'travel';
    }
    if (/\b(amazon|software|saas|subscription|aws|azure)\b/.test(hay)) {
      return 'software';
    }
    if (
      /\b(upi|paytm|phonepe|google\s*pay|gpay|money\s*sent|transaction\s*successful)\b/.test(
        hay,
      )
    ) {
      return 'other';
    }
    return null;
  }
}
