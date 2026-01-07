import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import { promisify } from 'util';
import { exec } from 'child_process';
import pdf from 'pdf-parse';
import Tesseract from 'tesseract.js';
import { fromPath } from 'pdf2pic';

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
        return await extractTextWithOCR(buffer); // Only pass buffer
      }
    } catch (pdfParseError) {
      console.log('pdf-parse failed, trying OCR fallback...');
      return await extractTextWithOCR(buffer); // Only pass buffer
    }

  } catch (error) {
    console.error('Extract text error:', error.message);
    throw new Error(`Failed to extract text from PDF: ${error.message}`);
  }
}

// OCR extraction using tesseract.js

export async function extractTextWithOCR(buffer) {
  try {
    // First, try normal PDF text extraction
    console.log('   Attempting direct PDF text extraction...');
    const data = await pdf(buffer);
    
    // Clean the extracted text
    let extractedText = data.text
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim();
    
    console.log(`   Direct extraction: ${extractedText.length} chars`);
    
    // If we got decent text, use it
    if (extractedText.length > 100) {
      console.log('   ✓ Using direct PDF extraction');
      
      // Additional cleaning to remove common duplicates
      extractedText = removeDuplicateLines(extractedText);
      
      return extractedText;
    }
    
    // If direct extraction failed, fall back to OCR
    console.log('   Direct extraction insufficient, trying OCR...');
    return await performOCR(buffer);
    
  } catch (err) {
    console.error('   PDF extraction error:', err.message);
    console.log('   Falling back to OCR...');
    return await performOCR(buffer);
  }
}

// Remove duplicate lines that often appear in PDFs
function removeDuplicateLines(text) {
  const lines = text.split('\n');
  const seen = new Set();
  const unique = [];
  
  for (const line of lines) {
    const normalized = line.trim().toLowerCase();
    
    // Skip empty lines
    if (!normalized) continue;
    
    // Skip if we've seen this exact line
    if (seen.has(normalized)) {
      continue;
    }
    
    seen.add(normalized);
    unique.push(line);
  }
  
  return unique.join('\n');
}

async function performOCR(buffer) {
  const tempDir = path.join(process.cwd(), 'temp-ocr');
  await fs.ensureDir(tempDir);
  
  try {
    // Save buffer as temporary PDF
    const tempPdfPath = path.join(tempDir, `temp-${Date.now()}.pdf`);
    await fs.writeFile(tempPdfPath, buffer);
    
    // Convert PDF pages to images
    const options = {
      density: 150,
      saveFilename: `ocr-${Date.now()}`,
      savePath: tempDir,
      format: "png",
      width: 2000,
      height: 2000
    };
    
    const convert = fromPath(tempPdfPath, options);
    
    // Get number of pages
    const pdfData = await pdf(buffer);
    const numPages = pdfData.numpages;
    console.log(`   OCR: Processing ${numPages} pages...`);
    
    let allText = '';
    const seenTexts = new Set(); // Track duplicate text blocks
    
    // Process each page
    for (let i = 1; i <= Math.min(numPages, 50); i++) { // Limit to 50 pages
      console.log(`   OCR: Page ${i}/${numPages}`);
      
      try {
        const pageImage = await convert(i, { responseType: "image" });
        
        // Perform OCR on the image
        const { data: { text } } = await Tesseract.recognize(
          pageImage.path,
          'eng',
          {
            logger: () => {} // Suppress OCR logs
          }
        );
        
        // Clean the OCR text
        const cleanText = text
          .replace(/\s+/g, ' ')
          .trim();
        
        // Only add if not a duplicate
        if (cleanText.length > 20 && !seenTexts.has(cleanText)) {
          allText += cleanText + '\n\n';
          seenTexts.add(cleanText);
        }
        
        // Clean up image file
        await fs.remove(pageImage.path);
        
      } catch (pageError) {
        console.error(`   OCR error on page ${i}:`, pageError.message);
      }
    }
    
    // Clean up temp PDF
    await fs.remove(tempPdfPath);
    
    console.log(`   ✓ OCR complete: ${allText.length} chars extracted`);
    return allText;
    
  } catch (err) {
    console.error('   OCR failed:', err);
    throw new Error(`OCR extraction failed: ${err.message}`);
  } finally {
    // Clean up temp directory
    try {
      await fs.remove(tempDir);
    } catch (cleanupErr) {
      console.error('   Failed to cleanup OCR temp files:', cleanupErr);
    }
  }
}