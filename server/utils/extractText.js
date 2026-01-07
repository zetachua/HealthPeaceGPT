import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import { promisify } from 'util';
import { exec } from 'child_process';
import Tesseract from 'tesseract.js';

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename); // <--- ADD THIS LINE
// OCR extraction using tesseract.js
export async function extractTextWithOCR(buffer) {
  let tmpDir = null;
  
  try {
    console.log('Running OCR on PDF...');

    // Create temporary directory
    tmpDir = path.join(__dirname, 'tmp_ocr', uuidv4());
    await fs.ensureDir(tmpDir);
    
    // Write buffer to temporary PDF file
    const tmpPdfPath = path.join(tmpDir, 'input.pdf');
    await fs.writeFile(tmpPdfPath, buffer);

    console.log(`Temporary PDF saved to: ${tmpPdfPath}`);

    // Convert PDF pages to PNG images
    // Requires `pdftoppm` installed: 
    // - Linux: apt-get install poppler-utils
    // - macOS: brew install poppler
    // - Docker: RUN apt-get update && apt-get install -y poppler-utils
    const outputPrefix = path.join(tmpDir, 'page');
    await execAsync(`pdftoppm -png "${tmpPdfPath}" "${outputPrefix}"`);

    // Read generated PNG files
    const files = await fs.readdir(tmpDir);
    const pngFiles = files.filter(f => f.endsWith('.png')).sort();

    if (pngFiles.length === 0) {
      throw new Error('No PNG images generated from PDF. Check if poppler-utils is installed.');
    }

    console.log(`Generated ${pngFiles.length} PNG files for OCR`);

    let fullText = '';
    for (const png of pngFiles) {
      const imagePath = path.join(tmpDir, png);
      console.log(`Processing page: ${png}`);
      
      const { data: { text } } = await Tesseract.recognize(
        imagePath, 
        'eng', 
        { 
          logger: m => {
            if (m.status === 'recognizing text') {
              console.log(`OCR progress: ${Math.round(m.progress * 100)}%`);
            }
          }
        }
      );
      
      fullText += text + '\n\n';
    }

    if (!fullText || fullText.trim().length === 0) {
      throw new Error('OCR could not extract any text from the PDF');
    }

    console.log(`OCR extraction successful. Text length: ${fullText.length}`);
    return fullText;

  } catch (ocrError) {
    console.error('OCR extraction failed:', ocrError.message);
    
    // Provide helpful error messages
    if (ocrError.message.includes('pdftoppm')) {
      throw new Error('Failed to convert PDF to images. Ensure poppler-utils is installed (apt-get install poppler-utils or brew install poppler)');
    }
    
    throw new Error(`Failed to extract text via OCR: ${ocrError.message}`);
    
  } finally {
    // Clean up temporary files
    if (tmpDir) {
      try {
        await fs.remove(tmpDir);
        console.log('Temporary OCR files cleaned up');
      } catch (cleanupError) {
        console.error('Failed to clean up temp directory:', cleanupError.message);
      }
    }
  }
}