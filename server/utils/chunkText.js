export function chunkText(text, size = 1000, overlap = 200) {
  if (!text || text.trim().length === 0) {
    console.log('Empty text provided for chunking');
    return [];
  }

  console.log(`Chunking text of length: ${text.length}`);
  
  const chunks = [];
  
  // Split into lines to detect headers
  const lines = text.split('\n');
  let currentHeader = '';
  let currentText = '';
  let chunkStartIndex = 0;
  
  // Rebuild text while tracking headers
  const processedLines = [];
  for (const line of lines) {
    const trimmedLine = line.trim();
    
    // Detect header: short line (20-100 chars), ends with punctuation or is ALL CAPS
    const isHeader = (
      trimmedLine.length > 5 && 
      trimmedLine.length < 100 &&
      (
        /^[A-Z\s]+$/.test(trimmedLine) || // ALL CAPS
        /[:]$/.test(trimmedLine) ||        // Ends with colon
        trimmedLine === trimmedLine.toUpperCase() // Uppercase
      )
    );
    
    if (isHeader) {
      currentHeader = trimmedLine;
      console.log(`   📋 Detected header: "${currentHeader}"`);
    }
    
    processedLines.push({
      text: line,
      header: currentHeader
    });
  }
  
  // Join back to text for chunking
  const fullText = processedLines.map(l => l.text).join('\n');
  
  // Now chunk with overlap
  let start = 0;
  let lineIndex = 0;
  
  while (start < fullText.length) {
    let end = Math.min(start + size, fullText.length);
    
    // Find good breaking point
    if (end < fullText.length) {
      const lastPeriod = fullText.lastIndexOf('. ', end);
      const lastNewline = fullText.lastIndexOf('\n', end);
      
      let boundary = Math.max(lastPeriod, lastNewline);
      
      if (boundary > start + size * 0.5) {
        end = boundary + 1;
      }
    }
    
    const chunkText = fullText.slice(start, end).trim();
    
    if (chunkText.length > 100) {
      // Find which header applies to this chunk (use header from start of chunk)
      const chunkStart = fullText.slice(0, start).split('\n').length;
      const relevantLine = processedLines[Math.min(chunkStart, processedLines.length - 1)];
      
      chunks.push({
        text: chunkText,
        header: relevantLine?.header || ''
      });
    }
    
    start = end - overlap;
    
    if (start >= fullText.length) break;
    if (chunks.length > 500) {
      console.warn(`Reached maximum chunk limit (500), stopping chunking`);
      break;
    }
  }
  
  console.log(`Created ${chunks.length} chunks`);
  
  if (chunks.length > 0) {
    const avgLength = chunks.reduce((sum, c) => sum + c.text.length, 0) / chunks.length;
    console.log(`Average chunk length: ${Math.round(avgLength)} characters`);
    console.log(`Sample chunk:`);
    console.log(`   Text: ${chunks[0].text.substring(0, 150)}...`);
    console.log(`   Header: "${chunks[0].header || 'None'}"`);
  }
  
  const MAX_CHUNKS = 100;
  if (chunks.length > MAX_CHUNKS) {
    console.warn(`Limiting to ${MAX_CHUNKS} chunks`);
    return chunks.slice(0, MAX_CHUNKS);
  }
  
  return chunks;
}