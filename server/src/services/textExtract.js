// Get plain text out of an uploaded file.
// Digital PDFs (the kind labs email you) contain real text we can read directly.
// Scanned PDFs are just images – they would need OCR, which this project does not do.
import { readFile } from 'node:fs/promises';
// Import the library file directly: pdf-parse's index.js runs a debug test when imported.
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import { UnrecoverableError } from 'bullmq';

export async function extractText(filePath, mimeType) {
  const buffer = await readFile(filePath);
  let text;
  if (mimeType === 'application/pdf') {
    text = (await pdfParse(buffer)).text;
  } else if (mimeType === 'text/plain') {
    text = buffer.toString('utf8');
  } else {
    throw new UnrecoverableError(`Unsupported file type ${mimeType}`);
  }
  if (text.replace(/\s/g, '').length < 50) {
    // Retrying won't help, so UnrecoverableError tells BullMQ not to retry.
    throw new UnrecoverableError('No readable text found – this looks like a scanned PDF (OCR not supported)');
  }
  return text;
}
