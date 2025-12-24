import fs from 'fs-extra';
import { exec } from 'child_process';
import { promisify } from 'util';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { fileURLToPath } from 'url';

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
        console.log('PDF appears to be empty or protected');
        throw new Error('Protected or image-based PDF');
      }
    } catch (pdfParseError) {
      console.log('pdf-parse failed, trying simpler extraction...');
      
      // Fallback: Try a simpler regex-based extraction for basic PDFs
      return extractTextSimple(buffer);
    }
    
  } catch (error) {
    console.error('Extract text error:', error.message);
    throw new Error(`Failed to extract text from PDF: ${error.message}`);
  }
}

// Simple fallback extraction for basic PDFs
function extractTextSimple(buffer) {
  try {
    // Convert buffer to string and look for text streams
    const bufferStr = buffer.toString('latin1');
    
    // Common PDF text patterns
    const textMatches = [];
    
    // Look for text in parentheses (common in PDFs)
    const parenMatches = bufferStr.match(/\(([^)]+)\)/g);
    if (parenMatches) {
      textMatches.push(...parenMatches.map(m => m.slice(1, -1)));
    }
    
    // Look for TJ/Tj operators (text showing operators)
    const tjMatches = bufferStr.match(/\[(.*?)\]/g);
    if (tjMatches) {
      textMatches.push(...tjMatches.map(m => m.slice(1, -1)));
    }
    
    // Join all found text
    const extractedText = textMatches.join(' ').replace(/\\\n/g, ' ').replace(/\\\r/g, ' ');
    
    if (extractedText.trim().length > 0) {
      console.log(`Simple extraction successful. Text length: ${extractedText.length}`);
      return extractedText;
    }
    
    throw new Error('No text could be extracted');
    
  } catch (simpleError) {
    console.error('Simple extraction failed:', simpleError.message);
    throw new Error('PDF appears to be protected or image-based. Please upload a text-based PDF.');
  }
}

// Optional OCR function (keep this if you need it)
async function extractTextWithOCR(filePath, buffer) {
  // ... (same OCR code as before if you need it)
  throw new Error('OCR not configured. Please upload a text-based PDF instead.');
}
