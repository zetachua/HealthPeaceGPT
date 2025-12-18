import fs from "fs/promises";
import { pdfToPng } from "pdf-to-png-converter";
import tesseract from "node-tesseract-ocr";
import mammoth from "mammoth";

const OCR_CONFIG = {
  lang: "eng",
  oem: 1,
  psm: 6, // Single uniform block – perfect for medical reports
};

async function runOcrOnPdfBuffer(buffer) {
  console.log("OCR fallback: Converting protected PDF to images + native Tesseract");

  // Convert PDF buffer to array of PNG page buffers (high quality)
  const pngPages = await pdfToPng(buffer, {
    disableFontFace: false,
    useSystemFonts: true,
    viewportScale: 3.0, // High resolution for clear text
    outputFormat: "buffer", // Returns Buffer[]
  });

  let fullText = "";
  for (let i = 0; i < pngPages.length; i++) {
    const pageBuffer = pngPages[i].content; // PNG Buffer

    const text = await tesseract.recognize(pageBuffer, OCR_CONFIG);
    fullText += text.trim() + "\n\n--- Page " + (i + 1) + " ---\n\n";

    console.log(`OCR done for page ${i + 1}/${pngPages.length}`);
  }

  return fullText.trim();
}

export async function extractText(filePath, mimetype, buffer) {
  if (!mimetype) throw new Error("Missing mimetype");

  if (mimetype === "application/pdf") {
    // For these protected reports, skip native text check – go straight to OCR
    return await runOcrOnPdfBuffer(buffer);
  }

  if (mimetype === "text/plain") {
    return buffer.toString("utf-8").trim();
  }

  if (mimetype.includes("word") || mimetype === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value.trim();
  }

  throw new Error(`Unsupported file type: ${mimetype}`);
}