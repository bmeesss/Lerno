import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { ApiError, errors } from '../lib/errors.js';

export const MAX_STUDIO_PDF_BYTES = 15 * 1024 * 1024;
export const MAX_STUDIO_PDF_PAGES = 100;
export const MAX_STUDIO_PDF_CHARS = 50_000;
const MAX_SCAN_CHARS = 80_000;

export interface ExtractedPdfText {
  text: string;
  pageCount: number;
  extractedChars: number;
  truncated: boolean;
}

/**
 * Extract selectable text only. The caller has already bounded the in-memory
 * upload; PDF.js receives bytes, never a filesystem path or a URL.
 */
export async function extractPdfText(buffer: Buffer): Promise<ExtractedPdfText> {
  if (buffer.length === 0 || buffer.length > MAX_STUDIO_PDF_BYTES) {
    throw errors.validation('Choose a PDF smaller than 15 MB.');
  }
  const signature = Buffer.from('%PDF-', 'ascii');
  if (buffer.subarray(0, 1024).indexOf(signature) === -1) {
    throw errors.validation('This file is not a valid PDF. Choose a PDF document and try again.');
  }

  let document: PDFDocumentProxy | undefined;
  try {
    const loadingTask = getDocument({
      data: new Uint8Array(buffer),
      isEvalSupported: false,
      useSystemFonts: false,
      verbosity: 0,
    });
    document = await loadingTask.promise;
    if (document.numPages > MAX_STUDIO_PDF_PAGES) {
      throw errors.validation(`This PDF has ${document.numPages} pages. The limit is ${MAX_STUDIO_PDF_PAGES} pages.`);
    }

    const chunks: string[] = [];
    let totalChars = 0;
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const textContent = await page.getTextContent();
      for (const item of textContent.items) {
        if (!('str' in item) || !item.str) continue;
        const piece = item.str.trim();
        if (!piece) continue;
        totalChars += piece.length + 1;
        if (totalChars <= MAX_SCAN_CHARS) chunks.push(piece);
        if (totalChars > MAX_SCAN_CHARS) break;
      }
      page.cleanup();
      if (totalChars > MAX_SCAN_CHARS) break;
    }

    const extracted = chunks.join(' ').replace(/\s+/g, ' ').trim();
    if (extracted.replace(/[\p{P}\p{S}\s]/gu, '').length < 20) {
      throw errors.validation(
        'This PDF has no readable selectable text. Scanned or image-only PDFs are not supported; paste the text instead.',
      );
    }
    const text = extracted.slice(0, MAX_STUDIO_PDF_CHARS);
    return {
      text,
      pageCount: document.numPages,
      extractedChars: Math.min(totalChars, MAX_SCAN_CHARS),
      truncated: totalChars > text.length,
    };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw errors.validation(
      'This PDF could not be read. It may be damaged or password-protected. Try another PDF or paste the text instead.',
    );
  } finally {
    try {
      await document?.destroy();
    } catch {
      // Cleanup errors must not replace the safe extraction result/error.
    }
  }
}
