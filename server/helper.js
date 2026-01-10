export function deduplicateChunks(chunks) {
  const seen = new Set();
  const unique = [];
  
  for (const chunk of chunks) {
    // Handle both string chunks and object chunks
    const text = typeof chunk === 'string' ? chunk : chunk.text;
    const header = typeof chunk === 'object' ? chunk.header : '';
    
    // Normalize: trim whitespace and convert to lowercase for comparison
    const normalized = text.trim().toLowerCase();
    
    // Skip if we've seen this exact content
    if (seen.has(normalized)) {
      console.log(`   ⚠️  Skipping duplicate chunk: ${text.substring(0, 50)}...`);
      continue;
    }
    
    // Skip if chunk is too short (likely noise)
    if (text.trim().length < 20) {
      console.log(`   ⚠️  Skipping short chunk: ${text}`);
      continue;
    }
    
    seen.add(normalized);
    
    // Return object format to preserve header
    unique.push({
      text: text,
      header: header
    });
  }
  
  return unique;
}
export function normalizeOCR(text) {
  return text
    .replace(/\r\n/g, '\n')           // Normalize line endings
    .replace(/\n{3,}/g, '\n\n')       // Collapse 3+ newlines to 2
    .replace(/[ \t]+/g, ' ')          // Collapse spaces/tabs (but not newlines!)
    .replace(/B1ood/g, 'Blood')
    .replace(/Pressu re/g, 'Pressure')
    .replace(/8O/g, '80')
    .trim();
}

  // export function extractDates(text) {
  //   const matches = text.match(/\b\d{1,2}\s(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s\d{4}\b/g);
  //   return matches ? [...new Set(matches)] : [];
  // }
  
  export function extractDates(text) {
    const dates = new Set();
    
    // Pattern 1: "24 Jun 2025", "15 Jul 1957"
    const pattern1 = /\b\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4}\b/gi;
    (text.match(pattern1) || []).forEach(d => dates.add(d));
    
    // Pattern 2: "June 2025", "July 1957"
    const pattern2 = /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}\b/gi;
    (text.match(pattern2) || []).forEach(d => dates.add(d));
    
    // Pattern 3: "2025", "1957" (standalone years)
    const pattern3 = /\b(19|20)\d{2}\b/g;
    (text.match(pattern3) || []).forEach(d => dates.add(d));
    
    // Pattern 4: "24/06/2025", "15/07/1957"
    const pattern4 = /\b\d{1,2}\/\d{1,2}\/\d{4}\b/g;
    (text.match(pattern4) || []).forEach(d => dates.add(d));
    
    return Array.from(dates);
  }