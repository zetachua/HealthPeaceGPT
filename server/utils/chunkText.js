export function chunkText(text, size = 1000, overlap = 200) {
    if (!text || text.trim().length === 0) {
      console.log('Empty text provided for chunking');
      return [];
    }
  
    console.log(`Chunking text of length: ${text.length}`);
    
    const chunks = [];
    
    // Clean the text first
    const cleanedText = text.replace(/\s+/g, ' ').trim();
    
    // Use smarter chunking that respects natural boundaries
    let start = 0;
    const textLength = cleanedText.length;
    
    while (start < textLength) {
      // Calculate potential end point
      let end = Math.min(start + size, textLength);
      
      // If we're not at the end of the text, look for a good breaking point
      if (end < textLength) {
        // Try to break at sentence boundaries first
        const lastPeriod = cleanedText.lastIndexOf('. ', end);
        const lastQuestion = cleanedText.lastIndexOf('? ', end);
        const lastExclamation = cleanedText.lastIndexOf('! ', end);
        
        // Find the best sentence boundary
        let boundary = Math.max(lastPeriod, lastQuestion, lastExclamation);
        
        // If no sentence boundary found, try paragraph or line break
        if (boundary < start + size * 0.5) { // Boundary is too early
          const lastNewline = cleanedText.lastIndexOf('\n', end);
          if (lastNewline > start + size * 0.5) {
            boundary = lastNewline;
          } else {
            // Last resort: break at word boundary
            const lastSpace = cleanedText.lastIndexOf(' ', end);
            if (lastSpace > start + size * 0.5) {
              boundary = lastSpace;
            }
          }
        }
        
        // If we found a good boundary, use it
        if (boundary > start + size * 0.5) {
          end = boundary + 1; // +1 to include the space or period
        }
      }
      
      // Extract the chunk and clean it
      const chunk = cleanedText.slice(start, end).trim();
      
      // Only add if it has meaningful content (not just whitespace/short)
      if (chunk.length > 100) { // Minimum chunk size
        chunks.push(chunk);
      }
      
      // Move start position with overlap
      start = end - overlap;
      
      // Safety check to prevent infinite loops
      if (start >= textLength) break;
      if (chunks.length > 500) { // Absolute max chunks
        console.warn(`Reached maximum chunk limit (500), stopping chunking`);
        break;
      }
    }
    
    console.log(`Created ${chunks.length} chunks`);
    
    // Log statistics
    if (chunks.length > 0) {
      const avgLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0) / chunks.length;
      console.log(`Average chunk length: ${Math.round(avgLength)} characters`);
      console.log(`First chunk (first 150 chars): ${chunks[0].substring(0, 150)}...`);
    }
    
    // Apply reasonable limits
    const MAX_CHUNKS = 100; // Maximum chunks per document
    if (chunks.length > MAX_CHUNKS) {
      console.warn(`Document has ${chunks.length} chunks, limiting to ${MAX_CHUNKS}`);
      
      // Keep only the first MAX_CHUNKS chunks
      // Alternatively, you could sample them: take every nth chunk
      return chunks.slice(0, MAX_CHUNKS);
    }
    
    return chunks;
  }
