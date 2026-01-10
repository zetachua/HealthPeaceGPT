import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import { promisify } from 'util';
import { exec } from 'child_process';
import Tesseract from 'tesseract.js';

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// OCR extraction using tesseract.js with parallel processing and progress callback
export async function extractTextWithOCR(buffer, onProgress = null) {
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

    // Convert PDF pages to PNG images with lower resolution for faster OCR
    const outputPrefix = path.join(tmpDir, 'page');
    // Add -r 150 for 150 DPI (faster than default 300 DPI, still readable)
    await execAsync(`pdftoppm -png -r 150 "${tmpPdfPath}" "${outputPrefix}"`);

    // Read generated PNG files
    const files = await fs.readdir(tmpDir);
    const pngFiles = files.filter(f => f.endsWith('.png')).sort();

    if (pngFiles.length === 0) {
      throw new Error('No PNG images generated from PDF. Check if poppler-utils is installed.');
    }

    console.log(`Generated ${pngFiles.length} PNG files for OCR`);

    const totalPages = pngFiles.length;
    const pageTexts = new Array(totalPages);
    
    // Process multiple pages in parallel (adjust based on server CPU cores)
    const PARALLEL_PAGES = 4; // Process 2 pages at once (increase to 3-4 if you have more CPU cores)
    
    for (let i = 0; i < pngFiles.length; i += PARALLEL_PAGES) {
      const batch = pngFiles.slice(i, i + PARALLEL_PAGES);
      
      console.log(`\nProcessing batch: pages ${i + 1} to ${Math.min(i + PARALLEL_PAGES, totalPages)}`);
      
      await Promise.all(
        batch.map(async (png, batchIndex) => {
          const pageIndex = i + batchIndex;
          const imagePath = path.join(tmpDir, png);
          const currentPage = pageIndex + 1;
          
          console.log(`  Processing page: ${png} (${currentPage}/${totalPages})`);
          
          // Report page start
          if (onProgress) {
            onProgress({
              stage: 'ocr',
              currentPage,
              totalPages,
              pageProgress: 0,
              overallProgress: (pageIndex / totalPages) * 100,
              message: `Processing page ${currentPage}/${totalPages}...`
            });
          }
          
          // Perform OCR with optimized settings
          const { data: { text } } = await Tesseract.recognize(
            imagePath, 
            'eng', 
            { 
              // Use AUTO for best accuracy, or SINGLE_BLOCK for faster processing
              tessedit_pageseg_mode: Tesseract.PSM.AUTO,
              logger: m => {
                if (m.status === 'recognizing text') {
                  const pageProgress = Math.round(m.progress * 100);
                  
                  // Only log every 20% to reduce console spam
                  if (pageProgress % 20 === 0) {
                    console.log(`    Page ${currentPage} OCR progress: ${pageProgress}%`);
                  }
                  
                  // Report OCR progress for this page (throttled to every 10%)
                  if (onProgress && pageProgress % 10 === 0) {
                    const overallProgress = ((pageIndex + m.progress) / totalPages) * 100;
                    onProgress({
                      stage: 'ocr',
                      currentPage,
                      totalPages,
                      pageProgress,
                      overallProgress,
                      message: `Page ${currentPage}/${totalPages}: ${pageProgress}%`
                    });
                  }
                }
              }
            }
          );
          
          pageTexts[pageIndex] = text;
          
          console.log(`  ✓ Completed page ${currentPage}/${totalPages}`);
          
          // Report page completion
          if (onProgress) {
            onProgress({
              stage: 'ocr',
              currentPage,
              totalPages,
              pageProgress: 100,
              overallProgress: ((pageIndex + 1) / totalPages) * 100,
              message: `Completed page ${currentPage}/${totalPages}`
            });
          }
        })
      );
    }
    
    // Join all page texts
    const fullText = pageTexts.join('\n\n');

    if (!fullText || fullText.trim().length === 0) {
      throw new Error('OCR could not extract any text from the PDF');
    }

    console.log(`OCR extraction successful. Text length: ${fullText.length}`);
    return fullText;

  } catch (ocrError) {
    console.error('OCR extraction failed:', ocrError.message);
    
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