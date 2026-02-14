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
    
    // Pattern 5: "26/02/24", "26/07/23", "06/09/22" (DD/MM/YY) - common in lab reports
    const pattern5 = /\b(\d{1,2})\/(\d{1,2})\/(\d{2})\b/g;
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    let m5;
    while ((m5 = pattern5.exec(text)) !== null) {
      const day = parseInt(m5[1], 10);
      const month = parseInt(m5[2], 10);
      const yy = parseInt(m5[3], 10);
      const year = yy <= 50 ? 2000 + yy : 1900 + yy;
      if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
        const formatted = `${String(day).padStart(2, '0')} ${monthNames[month - 1]} ${year}`;
        dates.add(formatted);
        dates.add(String(year));
      }
    }
    
    return Array.from(dates);
  }

  // Extract dates from filename (e.g., "240304" -> "04 Mar 2024")
  // Returns object with { primaryDate, year, allDates } where primaryDate is the authoritative date
  export function extractDatesFromFilename(filename) {
    const dates = new Set();
    let primaryDate = null;
    let primaryYear = null;
    
    if (!filename) return { primaryDate: null, primaryYear: null, allDates: [] };
    
    // Pattern 1: YYMMDD format (e.g., "240304" = 24/03/04 = March 4, 2024)
    // Matches 6-digit numbers at start of filename
    const yymmddPattern = /^(\d{2})(\d{2})(\d{2})/;
    const yymmddMatch = filename.match(yymmddPattern);
    if (yymmddMatch) {
      const [, yy, mm, dd] = yymmddMatch;
      const year = parseInt(yy) < 50 ? 2000 + parseInt(yy) : 1900 + parseInt(yy); // Assume 2000s if < 50
      const month = parseInt(mm);
      const day = parseInt(dd);
      
      if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const formattedDate = `${String(day).padStart(2, '0')} ${monthNames[month - 1]} ${year}`;
        primaryDate = formattedDate;
        primaryYear = String(year);
        dates.add(formattedDate);
        dates.add(String(year));
      }
    }
    
    // Pattern 2: YYYYMMDD format (e.g., "20240304" = 2024/03/04 = March 4, 2024)
    if (!primaryDate) {
      const yyyymmddPattern = /^(\d{4})(\d{2})(\d{2})/;
      const yyyymmddMatch = filename.match(yyyymmddPattern);
      if (yyyymmddMatch) {
        const [, yyyy, mm, dd] = yyyymmddMatch;
        const year = parseInt(yyyy);
        const month = parseInt(mm);
        const day = parseInt(dd);
        
        if (year >= 1900 && year <= 2100 && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
          const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
          const formattedDate = `${String(day).padStart(2, '0')} ${monthNames[month - 1]} ${year}`;
          primaryDate = formattedDate;
          primaryYear = String(year);
          dates.add(formattedDate);
          dates.add(String(year));
        }
      }
    }
    
    // Pattern 3: Extract any 4-digit year from filename (fallback)
    if (!primaryYear) {
      const yearPattern = /\b(19|20)\d{2}\b/g;
      const yearMatches = filename.match(yearPattern);
      if (yearMatches && yearMatches.length > 0) {
        primaryYear = yearMatches[0]; // Use first year found
        dates.add(primaryYear);
      }
    }
    
    return {
      primaryDate: primaryDate, // The authoritative date from filename (e.g., "04 Mar 2024")
      primaryYear: primaryYear, // The year from filename (e.g., "2024")
      allDates: Array.from(dates) // All dates extracted (for backward compatibility)
    };
  }

  // Merge dates from text and filename, prioritizing filename dates
  export function mergeDatesWithFilenamePriority(datesFromText, filenameDates) {
    const merged = new Set();
    
    // If we have a primary date from filename, use it and filter text dates by year
    if (filenameDates.primaryDate) {
      merged.add(filenameDates.primaryDate);
      merged.add(filenameDates.primaryYear);
      
      // Only include text dates that match the filename year
      if (filenameDates.primaryYear) {
        datesFromText.forEach(date => {
          // Include if it's the same year or if it's a full date that matches the year
          const dateYear = date.match(/\b(19|20)\d{2}\b/)?.[0];
          if (dateYear === filenameDates.primaryYear || !dateYear) {
            // Only add if it doesn't conflict with the primary date
            // Don't add standalone years that don't match
            if (dateYear || date.includes(filenameDates.primaryYear)) {
              merged.add(date);
            }
          }
        });
      }
    } else {
      // No filename date, use all dates from text
      datesFromText.forEach(d => merged.add(d));
      filenameDates.allDates.forEach(d => merged.add(d));
    }
    
    // Sort: primary date first, then others
    const sorted = Array.from(merged);
    if (filenameDates.primaryDate) {
      const primaryIndex = sorted.indexOf(filenameDates.primaryDate);
      if (primaryIndex > 0) {
        sorted.splice(primaryIndex, 1);
        sorted.unshift(filenameDates.primaryDate);
      }
    }
    
    return sorted;
  }