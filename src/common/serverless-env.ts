/** True when running on Vercel serverless (ephemeral disk, cold starts). */
export function isVercelServerless(): boolean {
  return process.env.VERCEL === '1';
}

/**
 * Tesseract OCR is unreliable on Vercel (slow, empty results). Skip unless explicitly forced.
 * Set ENABLE_RECEIPT_OCR=true to attempt OCR on Vercel anyway.
 */
export function isReceiptOcrEnabled(): boolean {
  if (process.env.SKIP_RECEIPT_OCR === 'true') return false;
  if (process.env.ENABLE_RECEIPT_OCR === 'true') return true;
  return !isVercelServerless();
}
