import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import { promisify } from 'util';
import { exec } from 'child_process';
import Tesseract from 'tesseract.js'; // Add this dependency

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Dynamic import for CommonJS module
async function loadPdfParse() {
  const pdfParseModule = await import('pdf-parse');
  return pdfParseModule.default || pdfParseModule;
}

export async function extractText(filePath, mimeType, buffer) {
  try {
    console.log(`Extracting text from: ${filePath}, MIME: ${mimeType}`);

    if (mimeType !== 'application/pdf') {
      throw new Error(`Unsupported file type: ${mimeType}. Only PDFs are supported.`);
    }

    // Try pdf-parse first
    try {
      const pdfParse = await loadPdfParse();
      const data = await pdfParse(buffer);

      if (data.text && data.text.trim().length > 0) {
        console.log(`PDF extracted successfully via pdf-parse. Text length: ${data.text.length}`);
        return data.text;
      } else {
        console.log('PDF appears empty or image-based. Falling back to OCR...');
        return await extractTextWithOCR(filePath, buffer);
      }
    } catch (pdfParseError) {
      console.log('pdf-parse failed, trying OCR fallback...');
      return await extractTextWithOCR(filePath, buffer);
    }

  } catch (error) {
    console.error('Extract text error:', error.message);
    throw new Error(`Failed to extract text from PDF: ${error.message}`);
  }
}

// OCR extraction using tesseract.js
async function extractTextWithOCR(filePath, buffer) {
  try {
    console.log('Running OCR on PDF...');

    // Convert PDF to images first using pdftoppm (from poppler utils)
    const tmpDir = path.join(__dirname, 'tmp_ocr', uuidv4());
    await fs.ensureDir(tmpDir);
    const tmpPdfPath = path.join(tmpDir, path.basename(filePath));
    await fs.writeFile(tmpPdfPath, buffer);

    // Convert PDF pages to PNG images
    // Requires `pdftoppm` installed: brew install poppler
    await execAsync(`pdftoppm -png "${tmpPdfPath}" "${tmpDir}/page"`);

    const files = await fs.readdir(tmpDir);
    const pngFiles = files.filter(f => f.endsWith('.png'));

    let fullText = '';
    for (const png of pngFiles) {
      const imagePath = path.join(tmpDir, png);
      const { data: { text } } = await Tesseract.recognize(imagePath, 'eng', { logger: m => console.log(m) });
      fullText += text + '\n\n';
    }

    // Clean up temporary files
    await fs.remove(tmpDir);

    if (!fullText || fullText.trim().length === 0) {
      throw new Error('OCR could not extract any text');
    }

    console.log(`OCR extraction successful. Text length: ${fullText.length}`);
    return fullText;

  } catch (ocrError) {
    console.error('OCR extraction failed:', ocrError.message);
    throw new Error('Failed to extract text via OCR. Ensure the PDF is readable.');
  }
}
