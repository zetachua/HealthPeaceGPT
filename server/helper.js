// Add this utility function to remove duplicate chunks
export function deduplicateChunks(chunks) {
    const seen = new Set();
    const unique = [];
    
    for (const chunk of chunks) {
      // Normalize: trim whitespace and convert to lowercase for comparison
      const normalized = chunk.trim().toLowerCase();
      
      // Skip if we've seen this exact content
      if (seen.has(normalized)) {
        console.log(`   ⚠️  Skipping duplicate chunk: ${chunk.substring(0, 50)}...`);
        continue;
      }
      
      // Skip if chunk is too short (likely noise)
      if (chunk.trim().length < 20) {
        console.log(`   ⚠️  Skipping short chunk: ${chunk}`);
        continue;
      }
      
      seen.add(normalized);
      unique.push(chunk);
    }
    
    return unique;
  }

  export function normalizeOCR(text) {
    return text
      .replace(/[\r\n]+/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/B1ood/g, 'Blood')
      .replace(/Pressu re/g, 'Pressure')
      .replace(/8O/g, '80')
      .trim();
  }
  
  
  // Improved chunking function
export function chunkTextImproved(text, chunkSize = 500, overlap = 50) {
    // Clean the text first
    const cleanedText = text
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim();
    
    if (cleanedText.length === 0) {
      return [];
    }
    
    const chunks = [];
    let start = 0;
    
    while (start < cleanedText.length) {
      let end = start + chunkSize;
      
      // Don't break in the middle of a word
      if (end < cleanedText.length) {
        // Look for a space to break at
        const nextSpace = cleanedText.indexOf(' ', end);
        if (nextSpace !== -1 && nextSpace - end < 100) {
          end = nextSpace;
        }
      }
      
      const chunk = cleanedText.slice(start, end).trim();
      if (chunk.length > 0) {
        chunks.push(chunk);
      }
      
      start = end - overlap; // Create overlap for context
    }
    
    return chunks;
  }

  export function extractDates(text) {
    const matches = text.match(/\b\d{1,2}\s(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s\d{4}\b/g);
    return matches ? [...new Set(matches)] : [];
  }
  