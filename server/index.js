import { createClient } from "@supabase/supabase-js";
import "dotenv/config";
import multer from "multer";
import express from "express";
import cors from "cors";
import fs from "fs-extra";
import { v4 as uuidv4 } from "uuid";
import path from "path";
import { fileURLToPath } from "url";
import { extractTextWithOCR } from "./utils/extractText.js";
import { chunkText } from "./utils/chunkText.js";
import { cosineSimilarity, embed } from "./utils/embedding.js";

import OpenAI from "openai";
import { deduplicateChunks, extractDates, extractDatesFromFilename, mergeDatesWithFilenamePriority, normalizeOCR } from "./helper.js";

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadProgress = new Map();

console.log("ENV LOADED:", process.env.OPENAI_API_KEY?.slice(0, 5));

const app = express();

app.use(cors({
  origin: 'https://zetachua.github.io',
  methods: ["GET", "POST", "DELETE", "OPTIONS"], // include DELETE
}));

app.use(express.json());

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Configure multer for file uploads
const upload = multer({ 
  dest: 'uploads/',
  limits: {
    fileSize: 30 * 1024 * 1024, // 10MB limit
  }
});

// Ensure uploads directory exists
fs.ensureDirSync('uploads');

// Root endpoint
app.get("/", (req, res) => {
  res.send("Server is running 👍");
});

// Upload endpoint
// app.post("/upload", upload.single("file"), async (req, res) => {
//   try {
//     if (!req.file) {
//       return res.status(400).json({ error: "No file uploaded" });
//     }

//     const fileId = uuidv4();
//     const filePath = req.file.path;
//     const fileName = req.file.originalname || `unnamed-${fileId}.pdf`;;
//     const buffer = await fs.readFile(filePath);

//     // 1. Extract raw text
//     const rawText = await extractText(filePath, req.file.mimetype, buffer);

//     // 2. Chunk text
//     const chunks = chunkText(rawText);
//     console.log("Number of chunks:", chunks.length);

//     // 3. Embed each chunk
//     const embeddedChunks = await Promise.all(
//       chunks.map(async (chunk) => ({
//         id: uuidv4(),
//         text: chunk,
//         embedding: await embed(chunk),
//       }))
//     );

//     // 4. Save the actual PDF file for viewing
//     const pdfStoragePath = path.join('uploads', `${fileId}.pdf`);
//     await fs.copy(filePath, pdfStoragePath);

//     // 5. Save to knowledge.json
//     const knowledge = await loadKnowledge();
//     knowledge.push({
//       id: fileId,
//       name: fileName,
//       createdAt: new Date().toISOString(),
//       chunks: embeddedChunks
//     });
//     await savePdfToKnowledge(knowledge);

//     // 6. Commit & deploy in background (non-blocking)
//     commitAndDeploy().catch(err => console.error(err));

//     // 7. Cleanup temporary uploaded file
//     await fs.remove(filePath);

//     res.status(200).json({
//       id: fileId,
//       name: fileName,
//       chunks: embeddedChunks.length
//     });

//   } catch (err) {
//     console.error("Upload failed:", err);

//     // Cleanup on error
//     if (req.file && req.file.path) {
//       await fs.remove(req.file.path).catch(() => {});
//     }

//     res.status(500).json({ error: "File processing failed" });
//   }
// });

// Delete endpoint
// app.delete("/delete/:id", async (req, res) => {
//   try {
//     const knowledge = await loadKnowledge();
//     const fileToDelete = knowledge.find(f => f.id === req.params.id);
    
//     if (!fileToDelete) {
//       return res.status(404).json({ error: "File not found" });
//     }

//     const updated = knowledge.filter(f => f.id !== req.params.id);
//     await saveKnowledge(updated);

//     // Also delete the stored PDF file if it exists
//     const pdfPath = path.join('uploads', `${req.params.id}.pdf`);
//     if (await fs.pathExists(pdfPath)) {
//       await fs.remove(pdfPath);
//     }

//     res.json({ success: true });
//   } catch (err) {
//     console.error("Delete error:", err);
//     res.status(500).json({ error: "Failed to delete file" });
//   }
// });

// REPLACE your existing /delete/:id endpoint with this:
app.delete("/delete/:id", async (req, res) => {
  const { id } = req.params;

  try {
    // Get document info using correct column name
    const { data: doc, error: fetchError } = await supabase
      .from("documents")
      .select("dropbox_path")
      .eq("id", id)
      .single();

    if (fetchError || !doc) {
      console.error("Document not found:", fetchError);
      return res.sendStatus(404);
    }

    // Delete from storage
    if (doc.dropbox_path) {
      const { error: storageError } = await supabase.storage
        .from("pdfs")
        .remove([doc.dropbox_path]);

      if (storageError) {
        console.error("Storage delete error:", storageError);
      }
    }

    // Delete chunks first (foreign key constraint)
    await supabase
      .from("chunks")
      .delete()
      .eq("document_id", id);

    // Delete document record
    const { error: deleteError } = await supabase
      .from("documents")
      .delete()
      .eq("id", id);

    if (deleteError) {
      console.error("Document delete error:", deleteError);
      return res.status(500).json({ error: deleteError.message });
    }

    res.sendStatus(204);
  } catch (err) {
    console.error("Delete failed:", err);
    res.status(500).json({ error: err.message });
  }
});

// REPLACE your existing /pdf/:id endpoint with this:
app.get("/pdf/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const { data, error } = await supabase
      .from("documents")
      .select("dropbox_path, name")
      .eq("id", id)
      .single();

    if (error || !data?.dropbox_path) {
      return res.status(404).json({ error: "PDF not found" });
    }

    // Get signed URL
    const { data: signed, error: signError } = await supabase.storage
      .from("pdfs")
      .createSignedUrl(data.dropbox_path, 60);

    if (signError || !signed?.signedUrl) {
      return res.status(500).json({ error: "Failed to sign URL" });
    }

    // Fetch PDF as buffer
    const pdfRes = await fetch(signed.signedUrl);
    const buffer = Buffer.from(await pdfRes.arrayBuffer());

    // 🔑 FORCE INLINE RENDERING
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${encodeURIComponent(data.name || "document.pdf")}"`
    );
    res.setHeader("Accept-Ranges", "bytes");

    res.send(buffer);
  } catch (err) {
    console.error("PDF serve error:", err);
    res.status(500).json({ error: "Failed to serve PDF" });
  }
});

// Get files list
// app.get("/files", async (req, res) => {
//   try {
//     const knowledge = await loadKnowledge();
//     res.json(
//       knowledge.map(file => ({
//         id: file.id,
//         name: file.name,
//         chunks: file.chunks?.length || 0,
//         createdAt: file.createdAt
//       }))
//     );
//   } catch (err) {
//     console.error("Files list error:", err);
//     res.status(500).json({ error: "Failed to fetch files" });
//   }
// });

// Serve PDF files
// app.get("/pdf/:id", async (req, res) => {
//   try {
//     const pdfPath = path.join(__dirname, 'uploads', `${req.params.id}.pdf`);
    
//     // Check if file exists
//     if (!await fs.pathExists(pdfPath)) {
//       return res.status(404).json({ 
//         error: "PDF file not found",
//         message: "The PDF file may have been deleted or not saved properly"
//       });
//     }

//     // Check if it's a valid PDF file
//     const stats = await fs.stat(pdfPath);
//     if (stats.size === 0) {
//       return res.status(404).json({ error: "PDF file is empty" });
//     }

//     // Set appropriate headers for PDF
//     res.setHeader('Content-Type', 'application/pdf');
//     res.setHeader('Content-Disposition', `inline; filename="${req.params.id}.pdf"`);
    
//     // Stream the PDF file
//     const fileStream = fs.createReadStream(pdfPath);
//     fileStream.pipe(res);
    
//     // Handle stream errors
//     fileStream.on('error', (err) => {
//       console.error("PDF stream error:", err);
//       res.status(500).json({ error: "Failed to stream PDF" });
//     });

//   } catch (err) {
//     console.error("PDF serve error:", err);
//     res.status(500).json({ error: "Failed to serve PDF" });
//   }
// });

// Alternative endpoint to get PDF content as text (Supabase-native)
app.get("/pdf-text/:id", async (req, res) => {
  try {
    const { id } = req.params;

    // 1. Fetch document metadata
    const { data: document, error: docError } = await supabase
      .from("documents")
      .select("id, name")
      .eq("id", id)
      .single();

    if (docError || !document) {
      return res.status(404).json({ error: "PDF not found" });
    }

    // 2. Fetch all chunks for this document
    const { data: chunks, error: chunkError } = await supabase
      .from("chunks")
      .select("text, embedding, document_id")
      .eq("document_id", id)
      .order("chunk_index", { ascending: true });

    if (chunkError) {
      throw chunkError;
    }

    const fullText = chunks.map(c => c.text).join("\n\n");

    res.json({
      id: document.id,
      name: document.name,
      content: fullText,
      chunksCount: chunks.length
    });

  } catch (err) {
    console.error("PDF text serve error:", err);
    res.status(500).json({ error: "Failed to get PDF text" });
  }
});


// Chat endpoint
// Updated chat endpoint with history support
// REPLACE your /chat endpoint with this deterministic version

app.post("/chat", async (req, res) => {
  try {
    const { message, history = [] } = req.body;
    if (!message) {
      return res.status(400).json({ error: "Message required" });
    }

    // Get full file list
    const { data: allDocuments, error: docListError } = await supabase
      .from("documents")
      .select("id, name, created_at")
      .order("name", { ascending: true });

    if (docListError) {
      console.error("Error fetching document list:", docListError);
    }

    const fileList = allDocuments?.map(d => d.name) || [];
    const fileListStr = fileList.length > 0 
      ? `Available documents (${fileList.length} total):\n${fileList.map((name, i) => `${i + 1}. ${name}`).join('\n')}`
      : "No documents are currently available.";

    // Detect query type
    const testKeywords = ['hdl', 'ldl', 'cholesterol', 'glucose', 'blood', 'test', 'reading', 'level', 'value', 'triglyceride', 'a1c', 'hba1c'];
    const isTestQuery = testKeywords.some(keyword => message.toLowerCase().includes(keyword));
    
    const documentNameMatch = message.match(/(?:in|from|document|file|pdf)\s+["']?([^"']+)["']?/i);
    const queriedDocName = documentNameMatch ? documentNameMatch[1].trim() : null;
    
    const queriedDates = extractDates(message);

    // 1. Embed query
    const queryEmbedding = await embed(message);

    // 2. Load chunks WITH METADATA
    const { data: chunks, error } = await supabase
      .from("chunks")
      .select("text, embedding, document_id, dates, document_name, section_header, chunk_index")
      .order("document_id", { ascending: true }) // 🔥 CRITICAL: Order by document_id first
      .order("chunk_index", { ascending: true }); // 🔥 Then by chunk_index

    if (error) throw error;
    if (!chunks || chunks.length === 0) {
      return res.json({
        answer: "No documents are available to answer this question."
      });
    }

    // 3. Score chunks with DETERMINISTIC HYBRID SCORING
    const scoredChunks = chunks
      .map((c, originalIndex) => { // 🔥 Keep original index for tie-breaking
        let embedding = c.embedding;
        if (typeof embedding === "string") {
          embedding = embedding
            .replace(/[\[\]]/g, "")
            .split(",")
            .map(Number);
        }
        if (!Array.isArray(embedding)) return null;

        // Calculate semantic similarity
        let score = cosineSimilarity(queryEmbedding, embedding);
        
        // 🔥 DETERMINISTIC: Round score to 6 decimal places to avoid floating-point drift
        score = Math.round(score * 1000000) / 1000000;
        
        // Boost score if document name matches
        if (queriedDocName && c.document_name) {
          const docNameLower = c.document_name.toLowerCase();
          const queryNameLower = queriedDocName.toLowerCase();
          if (docNameLower.includes(queryNameLower) || queryNameLower.includes(docNameLower)) {
            score = Math.round(score * 1.5 * 1000000) / 1000000;
            console.log(`📄 Boosted score for document match: ${c.document_name}`);
          }
        }
        
        // Boost score if section header matches
        if (c.section_header) {
          const headerLower = c.section_header.toLowerCase();
          const messageLower = message.toLowerCase();
          const headerWords = headerLower.split(/\s+/).sort(); // 🔥 DETERMINISTIC: Sort words
          const matchingWords = headerWords.filter(word => 
            word.length > 3 && messageLower.includes(word)
          );
          if (matchingWords.length > 0) {
            const headerBoost = 1 + (matchingWords.length * 0.2);
            score = Math.round(score * headerBoost * 1000000) / 1000000;
            console.log(`📋 Boosted score for header match: ${c.section_header} (${headerBoost.toFixed(2)}x)`);
          }
        }
        
        // Boost score if dates match
        if (queriedDates.length > 0 && c.dates && c.dates.length > 0) {
          // 🔥 DETERMINISTIC: Sort dates before comparison
          const sortedQueryDates = [...queriedDates].sort();
          const sortedChunkDates = [...c.dates].sort();
          
          const hasMatchingDate = sortedQueryDates.some(qd => 
            sortedChunkDates.some(cd => cd.includes(qd) || qd.includes(cd))
          );
          if (hasMatchingDate) {
            score = Math.round(score * 1.3 * 1000000) / 1000000;
            console.log(`📅 Boosted score for date match: ${c.dates.join(', ')}`);
          }
        }
        
        // Boost score if chunk text contains test keywords
        if (isTestQuery) {
          const messageLower = message.toLowerCase();
          const textLower = (c.text || '').toLowerCase();
          const matchingTestKeyword = testKeywords.find(keyword => 
            messageLower.includes(keyword) && textLower.includes(keyword)
          );
          if (matchingTestKeyword) {
            score = Math.round(score * 1.4 * 1000000) / 1000000;
            console.log(`🧪 Boosted score for test keyword match: ${matchingTestKeyword}`);
          }
        }

        return {
          text: c.text,
          document_id: c.document_id,
          document_name: c.document_name,
          section_header: c.section_header,
          dates: c.dates ? [...c.dates].sort() : [], // 🔥 DETERMINISTIC: Sort dates
          chunk_index: c.chunk_index,
          score: score,
          _originalIndex: originalIndex // 🔥 For final tie-breaking
        };
      })
      .filter(Boolean);

    // 🔥 DETERMINISTIC SORTING: Multiple tie-breakers
    scoredChunks.sort((a, b) => {
      // 1. By score (with tolerance for floating point)
      const scoreDiff = Math.abs(a.score - b.score);
      if (scoreDiff > 0.000001) return b.score - a.score;
      
      // 2. By document_id (alphabetical)
      const docCompare = (a.document_id || '').localeCompare(b.document_id || '');
      if (docCompare !== 0) return docCompare;
      
      // 3. By chunk_index (numerical)
      const chunkCompare = (a.chunk_index || 0) - (b.chunk_index || 0);
      if (chunkCompare !== 0) return chunkCompare;
      
      // 4. By original index (final tie-breaker)
      return a._originalIndex - b._originalIndex;
    });

    // 🔥 GROUP BY DOCUMENT - Deterministic grouping
    const byDoc = {};
    for (const c of scoredChunks) {
      byDoc[c.document_id] ||= [];
      byDoc[c.document_id].push(c);
    }

    // 🔥 DETERMINISTIC: Sort document IDs for consistent iteration
    const sortedDocIds = Object.keys(byDoc).sort();

    let balancedChunks;
    
    if (isTestQuery) {
      // For test queries, get ALL chunks with the keyword, regardless of score
      const messageLower = message.toLowerCase();
      const matchingKeyword = testKeywords.find(kw => messageLower.includes(kw));
      
      console.log(`🔍 Test query detected for keyword: "${matchingKeyword}"`);
      
      // FIRST: Get ALL chunks that contain the keyword (from ALL scored chunks, not filtered)
      const allKeywordChunks = scoredChunks.filter(chunk => {
        const textLower = (chunk.text || '').toLowerCase();
        return matchingKeyword && textLower.includes(matchingKeyword);
      });
      
      console.log(`📊 Found ${allKeywordChunks.length} total chunks containing "${matchingKeyword}"`);
      
      // Group keyword chunks by year
      const byYear = {};
      allKeywordChunks.forEach(chunk => {
        if (chunk.dates && Array.isArray(chunk.dates) && chunk.dates.length > 0) {
          chunk.dates.forEach(date => {
            const yearMatch = date.match(/\b(19|20)\d{2}\b/);
            if (yearMatch) {
              const year = yearMatch[0];
              byYear[year] ||= [];
              byYear[year].push(chunk);
            }
          });
        }
        // Also include chunks without explicit dates
        if (!chunk.dates || chunk.dates.length === 0) {
          byYear['no-date'] ||= [];
          byYear['no-date'].push(chunk);
        }
      });
      
      // 🔥 DETERMINISTIC: Sort years
      const sortedYears = Object.keys(byYear).filter(y => y !== 'no-date').sort();
      
      // Take ALL chunks with keyword from each year (no limit, no score filtering)
      const chunksByYear = sortedYears.flatMap(year => {
        const yearChunks = byYear[year] || [];
        
        // Deduplicate by document_id + chunk_index
        const uniqueChunks = [];
        const seen = new Set();
        yearChunks.forEach(chunk => {
          const key = `${chunk.document_id}-${chunk.chunk_index}`;
          if (!seen.has(key)) {
            seen.add(key);
            uniqueChunks.push(chunk);
          }
        });
        
        // Sort deterministically (by document, then chunk_index)
        uniqueChunks.sort((a, b) => {
          const docCompare = (a.document_id || '').localeCompare(b.document_id || '');
          if (docCompare !== 0) return docCompare;
          const chunkCompare = (a.chunk_index || 0) - (b.chunk_index || 0);
          if (chunkCompare !== 0) return chunkCompare;
          return a._originalIndex - b._originalIndex;
        });
        
        console.log(`📅 Year ${year}: ${uniqueChunks.length} chunks with keyword "${matchingKeyword}"`);
        // Return ALL chunks with keyword (no slice limit, no score filtering)
        return uniqueChunks;
      });
      
      // Also include no-date chunks
      if (byYear['no-date'] && byYear['no-date'].length > 0) {
        const noDateChunks = byYear['no-date'];
        const seen = new Set();
        const uniqueNoDate = [];
        noDateChunks.forEach(chunk => {
          const key = `${chunk.document_id}-${chunk.chunk_index}`;
          if (!seen.has(key)) {
            seen.add(key);
            uniqueNoDate.push(chunk);
          }
        });
        chunksByYear.push(...uniqueNoDate);
        console.log(`📅 No-date: ${uniqueNoDate.length} chunks with keyword "${matchingKeyword}"`);
      }
      
      // Final deduplication
      const seen = new Set();
      const deduped = [];
      
      chunksByYear.forEach(chunk => {
        const key = `${chunk.document_id}-${chunk.chunk_index}`;
        if (!seen.has(key)) {
          seen.add(key);
          deduped.push(chunk);
        }
      });
      // 🔥 NEW: Add adjacent chunks (1 before and 1 after) for each keyword chunk
      // This captures historical data from the same document
      const keywordChunkKeys = new Set(deduped.map(c => `${c.document_id}-${c.chunk_index}`));
      const adjacentChunks = [];
      
      deduped.forEach(keywordChunk => {
        const docId = keywordChunk.document_id;
        const chunkIdx = keywordChunk.chunk_index;
        
        // Find chunks from the same document that are adjacent
        scoredChunks.forEach(chunk => {
          if (chunk.document_id === docId) {
            const key = `${chunk.document_id}-${chunk.chunk_index}`;
            // Include chunk_index - 1 and chunk_index + 1
            if ((chunk.chunk_index === chunkIdx - 1 || chunk.chunk_index === chunkIdx + 1) 
                && !keywordChunkKeys.has(key)) {
              adjacentChunks.push(chunk);
            }
          }
        });
      });
      
      // Deduplicate adjacent chunks
      const seenAdjacent = new Set();
      const uniqueAdjacent = [];
      adjacentChunks.forEach(chunk => {
        const key = `${chunk.document_id}-${chunk.chunk_index}`;
        if (!seenAdjacent.has(key) && !keywordChunkKeys.has(key)) {
          seenAdjacent.add(key);
          uniqueAdjacent.push(chunk);
        }
      });
      
      console.log(`📎 Added ${uniqueAdjacent.length}/${adjacentChunks.length} adjacent chunks for context`);
      
      // Combine keyword chunks and adjacent chunks
      const allChunksWithContext = [...deduped, ...uniqueAdjacent];
      
      // Sort deterministically: by document, then chunk_index (to keep adjacent chunks together)
      allChunksWithContext.sort((a, b) => {
        // First by document
        const docCompare = (a.document_id || '').localeCompare(b.document_id || '');
        if (docCompare !== 0) return docCompare;
        
        // Then by chunk index (to keep adjacent chunks together)
        const chunkCompare = (a.chunk_index || 0) - (b.chunk_index || 0);
        if (chunkCompare !== 0) return chunkCompare;
        
        // Final tie-breaker
        return a._originalIndex - b._originalIndex;
      });
      
      // Take ALL chunks (keyword + adjacent) for test queries
      balancedChunks = allChunksWithContext;
      
      const yearCounts = {};
      balancedChunks.forEach(chunk => {
        if (chunk.dates && Array.isArray(chunk.dates)) {
          chunk.dates.forEach(date => {
            const yearMatch = date.match(/\b(19|20)\d{2}\b/);
            if (yearMatch) {
              const year = yearMatch[0];
              yearCounts[year] = (yearCounts[year] || 0) + 1;
            }
          });
        }
      });
      console.log(`📊 Test query - years found: ${sortedYears.join(', ')} (total: ${balancedChunks.length} keyword chunks)`);
      console.log(`📊 Chunks per year: ${JSON.stringify(yearCounts)}`);
      
      // Log sample chunks from each year to verify
      sortedYears.forEach(year => {
        const yearChunks = balancedChunks.filter(c => {
          return c.dates?.some(d => d.match(/\b(19|20)\d{2}\b/)?.[0] === year);
        });
        if (yearChunks.length > 0) {
          console.log(`   ${year}: ${yearChunks.length} chunks - Sample: ${yearChunks[0].document_name}`);
        }
      });
    } else {
      // Non-test queries
      balancedChunks = sortedDocIds
        .flatMap(docId => byDoc[docId].slice(0, 20))
        .slice(0, 30);
    }

    // Debug top chunks
    console.log('\n🔍 Top scored chunks:');
    balancedChunks.slice(0, 5).forEach((c, i) => {
      console.log(`${i + 1}. Score: ${c.score.toFixed(6)} | Doc: ${c.document_name} | Dates: ${c.dates?.join(', ') || 'N/A'}`);
      console.log(`   Preview: ${c.text.slice(0, 80)}...`);
    });

    // For test queries, skip quality check if we have keyword chunks
    // (we already filtered for keyword chunks, so they're all relevant)
    if (!isTestQuery) {
      const bestScore = balancedChunks[0]?.score ?? 0;
      if (bestScore < 0.15) {
        return res.json({
          answer: "I couldn't find relevant information in the uploaded documents to answer that question."
        });
      }
    } else if (balancedChunks.length === 0) {
      // For test queries, only fail if we found NO keyword chunks at all
      return res.json({
        answer: "I couldn't find relevant information in the uploaded documents to answer that question."
      });
    }

    // Extract all unique dates: from chunk metadata AND from chunk text (so table headers like 26/07/23, 06/09/22 are allowed)
    const allAvailableDates = new Set();
    balancedChunks.forEach(c => {
      if (c.dates && Array.isArray(c.dates)) {
        c.dates.forEach(d => allAvailableDates.add(d.toLowerCase()));
      }
      // Dates in chunk text (e.g. lab table columns "Date: 26/02/24 26/07/23 06/09/22") must be in the list so the model can cite them
      const textDates = extractDates(c.text || '');
      textDates.forEach(d => allAvailableDates.add(d.toLowerCase()));
    });
    const sortedAvailableDates = Array.from(allAvailableDates).sort();

    // Build context deterministically
    // For each chunk, extract the primary date from filename and prioritize it
    const context = balancedChunks
      .map((c) => {
        const metadata = [];
        if (c.document_name) metadata.push(`Document: ${c.document_name}`);
        if (c.section_header) metadata.push(`Section: ${c.section_header}`);
        
        // Extract filename date and prioritize it
        if (c.document_name) {
          const filenameDates = extractDatesFromFilename(c.document_name);
          if (filenameDates.primaryDate) {
            // Use primary date from filename as the authoritative date
            metadata.push(`Date: ${filenameDates.primaryDate} (from filename)`);
            // Also include other dates that match the filename year
            if (c.dates && c.dates.length > 0) {
              const matchingDates = c.dates.filter(d => {
                const dateYear = d.match(/\b(19|20)\d{2}\b/)?.[0];
                return !dateYear || dateYear === filenameDates.primaryYear || d === filenameDates.primaryDate;
              });
              if (matchingDates.length > 1) {
                metadata.push(`Additional dates: ${matchingDates.filter(d => d !== filenameDates.primaryDate).join(', ')}`);
              }
            }
          } else if (c.dates && c.dates.length > 0) {
            // No filename date, use all dates from chunk
            metadata.push(`Dates: ${c.dates.join(', ')}`);
          }
        } else if (c.dates && c.dates.length > 0) {
          metadata.push(`Dates: ${c.dates.join(', ')}`);
        }
        
        if (c.chunk_index !== undefined) metadata.push(`Chunk: ${c.chunk_index}`);
        
        const metadataStr = metadata.length > 0 ? `[${metadata.join(' | ')}]\n` : '';
        return `${metadataStr}${c.text}`;
      })
      .join("\n\n");

    const deduplicatedContext = deduplicateContextChunks(context);

    // Log chunks being fed to the prompt (for verifying retrieval)
    console.log('\n📥 CHUNKS FED TO PROMPT (context):');
    balancedChunks.forEach((c, i) => {
      const doc = c.document_name || 'unknown';
      const idx = c.chunk_index !== undefined ? c.chunk_index : '?';
      const dates = c.dates?.length ? c.dates.join(', ') : 'none';
      const section = c.section_header || '';
      const preview = (c.text || '').slice(0, 100).replace(/\n/g, ' ');
      console.log(`  ${i + 1}. [${doc}] chunk_index=${idx} | dates=[${dates}] | section=${section}`);
      console.log(`     preview: ${preview}${(c.text || '').length > 100 ? '...' : ''}`);
    });
    console.log(`  Total: ${balancedChunks.length} chunks\n`);

    // Generate answer
    const answer = await generateAnswerWithHistory(
      deduplicatedContext, 
      message, 
      history, 
      fileListStr, 
      balancedChunks,
      sortedAvailableDates
    );

    res.json({ answer });

  } catch (err) {
    console.error("Chat error:", err);
    res.status(500).json({ error: "Chat failed" });
  }
});

// Helper function to deduplicate context chunks
function deduplicateContextChunks(context) {
  const lines = context.split('\n\n');
  const seen = new Set();
  const unique = [];
  
  for (const line of lines) {
    // Extract the actual text content (after metadata)
    const textMatch = line.match(/\]\n(.+)/s);
    const text = textMatch ? textMatch[1].trim() : line.trim();
    const normalized = text.toLowerCase().replace(/\s+/g, ' ').substring(0, 200);
    
    if (!seen.has(normalized) && text.length > 20) {
      seen.add(normalized);
      unique.push(line);
    }
  }
  
  return unique.join('\n\n');
}

// Helper function to estimate tokens (rough approximation: ~4 chars per token)
function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

// Updated generateAnswer function with history support
// REPLACE your generateAnswerWithHistory function with this version

async function generateAnswerWithHistory(context, question, history = [], fileListStr = "", chunks = [], availableDates = []) {
  const MAX_TOKENS = 30000;
  const RESERVE_TOKENS = 5000;
  const MAX_CONTEXT_TOKENS = MAX_TOKENS - RESERVE_TOKENS;
  
  let optimizedContext = context;
  let contextTokens = estimateTokens(context);
  
  // Log which chunks were passed in (same as "fed to prompt" unless truncation happens below)
  // console.log(`📋 generateAnswerWithHistory: received ${chunks.length} chunks, context ~${contextTokens} tokens`);
  
  // Check if this is a test query by checking if chunks contain test keywords
  const isTestQueryContext = chunks.some(c => {
    const textLower = (c.text || '').toLowerCase();
    return ['hdl', 'ldl', 'cholesterol', 'glucose'].some(kw => textLower.includes(kw));
  });
  
  if (contextTokens > MAX_CONTEXT_TOKENS) {
    // console.log(`⚠️  Context too large (${contextTokens} tokens), truncating to ${MAX_CONTEXT_TOKENS}`);
    
    if (isTestQueryContext) {
      // For test queries, preserve year diversity when truncating
      const byYear = {};
      chunks.forEach(chunk => {
        if (chunk.dates && Array.isArray(chunk.dates)) {
          chunk.dates.forEach(date => {
            const yearMatch = date.match(/\b(19|20)\d{2}\b/);
            if (yearMatch) {
              const year = yearMatch[0];
              byYear[year] ||= [];
              byYear[year].push(chunk);
            }
          });
        } else {
          byYear['no-date'] ||= [];
          byYear['no-date'].push(chunk);
        }
      });
      
      const sortedYears = Object.keys(byYear).filter(y => y !== 'no-date').sort();
      const selectedChunks = [];
      let accumulatedTokens = 0;
      
      // Take chunks from each year proportionally
      for (const year of sortedYears) {
        const yearChunks = byYear[year];
        for (const chunk of yearChunks) {
          const chunkText = chunk.text || '';
          const chunkTokens = estimateTokens(chunkText) + 150; // Add metadata overhead
          if (accumulatedTokens + chunkTokens > MAX_CONTEXT_TOKENS * 0.95) break; // Leave 5% buffer
          
          selectedChunks.push(chunk);
          accumulatedTokens += chunkTokens;
        }
      }
      
      optimizedContext = selectedChunks
        .map((c) => {
          const metadata = [];
          if (c.document_name) metadata.push(`Document: ${c.document_name}`);
          if (c.section_header) metadata.push(`Section: ${c.section_header}`);
          
          // Extract filename date and prioritize it
          if (c.document_name) {
            const filenameDates = extractDatesFromFilename(c.document_name);
            if (filenameDates.primaryDate) {
              metadata.push(`Date: ${filenameDates.primaryDate} (from filename)`);
              if (c.dates && c.dates.length > 0) {
                const matchingDates = c.dates.filter(d => {
                  const dateYear = d.match(/\b(19|20)\d{2}\b/)?.[0];
                  return !dateYear || dateYear === filenameDates.primaryYear || d === filenameDates.primaryDate;
                });
                if (matchingDates.length > 1) {
                  metadata.push(`Additional dates: ${matchingDates.filter(d => d !== filenameDates.primaryDate).join(', ')}`);
                }
              }
            } else if (c.dates && c.dates.length > 0) {
              metadata.push(`Dates: ${c.dates.join(', ')}`);
            }
          } else if (c.dates && c.dates.length > 0) {
            metadata.push(`Dates: ${c.dates.join(', ')}`);
          }
          
          if (c.chunk_index !== undefined) metadata.push(`Chunk: ${c.chunk_index}`);
          const metadataStr = metadata.length > 0 ? `[${metadata.join(' | ')}]\n` : '';
          return `${metadataStr}${c.text}`;
        })
        .join("\n\n");
      
      console.log(`✓ Preserved year diversity: ${accumulatedTokens} tokens, years: ${sortedYears.join(', ')}`);
      console.log(`📥 After truncation, ${selectedChunks.length} chunks in context: ${selectedChunks.map(c => `${c.document_name}#${c.chunk_index}`).join(', ')}`);
    } else {
      // For non-test queries, use simple truncation
      let accumulatedTokens = 0;
      const selectedChunks = [];
      
      for (const chunk of chunks) {
        const chunkText = chunk.text || '';
        const chunkTokens = estimateTokens(chunkText) + 150;
        if (accumulatedTokens + chunkTokens > MAX_CONTEXT_TOKENS) break;
        
        selectedChunks.push(chunk);
        accumulatedTokens += chunkTokens;
      }
      
      console.log(`📥 After truncation, ${selectedChunks.length} chunks in context: ${selectedChunks.map(c => `${c.document_name}#${c.chunk_index}`).join(', ')}`);
      optimizedContext = selectedChunks
        .map((c) => {
          const metadata = [];
          if (c.document_name) metadata.push(`Document: ${c.document_name}`);
          if (c.section_header) metadata.push(`Section: ${c.section_header}`);
          
          // Extract filename date and prioritize it
          if (c.document_name) {
            const filenameDates = extractDatesFromFilename(c.document_name);
            if (filenameDates.primaryDate) {
              metadata.push(`Date: ${filenameDates.primaryDate} (from filename)`);
              if (c.dates && c.dates.length > 0) {
                const matchingDates = c.dates.filter(d => {
                  const dateYear = d.match(/\b(19|20)\d{2}\b/)?.[0];
                  return !dateYear || dateYear === filenameDates.primaryYear || d === filenameDates.primaryDate;
                });
                if (matchingDates.length > 1) {
                  metadata.push(`Additional dates: ${matchingDates.filter(d => d !== filenameDates.primaryDate).join(', ')}`);
                }
              }
            } else if (c.dates && c.dates.length > 0) {
              metadata.push(`Dates: ${c.dates.join(', ')}`);
            }
          } else if (c.dates && c.dates.length > 0) {
            metadata.push(`Dates: ${c.dates.join(', ')}`);
          }
          
          if (c.chunk_index !== undefined) metadata.push(`Chunk: ${c.chunk_index}`);
          const metadataStr = metadata.length > 0 ? `[${metadata.join(' | ')}]\n` : '';
          return `${metadataStr}${c.text}`;
        })
        .join("\n\n");
    }
  }
  
  // 🔥 CRITICAL: Create deterministic date list for the prompt
  const dateListForPrompt = availableDates.length > 0
    ? `AVAILABLE DATES IN CONTEXT (EXHAUSTIVE LIST):\n${availableDates.map((d, i) => `${i + 1}. ${d}`).join('\n')}\n\nYou MUST ONLY reference dates from this list. ANY date not in this list is HALLUCINATED.`
    : 'No specific dates found in context.';

  const conversationMessages = [
    {
      role: "system",
      content: `You are HealthPeaceGPT, a health assistant for Brian Peace.

**CRITICAL ANTI-HALLUCINATION RULES - VIOLATION OF THESE IS A SEVERE ERROR:**

1. **Document Names**: ONLY reference documents from this list:
${fileListStr}
   - If asked about a document NOT in this list, say: "I don't have access to that document."
   - NEVER make up document names.

2. **Dates and Years**:
   ${dateListForPrompt}
   - Before mentioning ANY date or year, verify it's in the list above
   - If a year/date is not in the list, say: "I don't have data for [year] in the uploaded documents"
   - NEVER infer, create, or guess dates

3. **Data Values**:
   - ONLY state values explicitly present in the context below
   - If data is missing, say: "I don't have that information"
   - If data is unclear, say: "The data appears incomplete or unclear"
   - NEVER guess or make up numbers

4. **Completeness**:
   - When showing health readings over time, ONLY include dates/years from the available dates list
   - If context has data for 2023, 2024, 2025 but NOT 2016, do NOT create 2016 data
   - Better to have gaps than to hallucinate

**CRITICAL: For queries about specific tests (HDL, LDL, etc.):**
- **Regardless of how the user phrases the question** ("what's my HDL", "show my HDL", "HDL levels", "list all dates and readings for my HDL"), you MUST always return the **complete, exhaustive** list of all dates and readings from the context. Treat every such query as "list all the dates and readings for [this test]" - same full table, no summarization and no omitted rows.
- Extract ALL matching values from the context - DO NOT MISS ANY
- You MUST scan through the ENTIRE context and extract EVERY instance
- Match each value with its corresponding date from the available dates list
- Present in a table with columns: Date | Value | Reference Range | Source
- If two chunks have the same date and value, include it only ONCE (deduplicate)
- Sort chronologically (oldest to newest)
- If you see data from 2023, 2024, 2025, 2026, you MUST include ALL of them

**When creating tables - STEP BY STEP PROCESS:**
1. FIRST: Read through the ENTIRE context from start to finish
2. SECOND: Identify EVERY chunk that mentions the requested test (e.g., "HDL")
   - This includes chunks with the keyword AND their adjacent chunks (which may contain historical data from other years)
3. THIRD: For EACH chunk found, extract:
   - **Date**: 
     * The metadata shows the document date (from filename), but the chunk text may contain historical data
     * Look for dates in the chunk text itself - a 2024 document may show 2023/2022 test results in adjacent chunks
     * Extract the ACTUAL date when the test was taken from the text (e.g., "2023", "2022", "26 Feb 2023")
     * If text shows "2023" or "2022" alongside test values, use those years for that data point
     * The document date (from filename) is when the document was created, but tests may be from earlier years
   - Value (the numeric value for the test)
   - Reference Range (if mentioned)
   - Source (Document name from metadata)
4. FOURTH: Create a list of ALL extracted entries
5. FIFTH: Deduplicate by date+value (if same date has same value multiple times, keep one)
6. SIXTH: Sort by date (oldest first)
7. SEVENTH: Present in markdown table format

**CRITICAL DATE EXTRACTION RULES:**
- Dates in metadata [Date: ...] with "(from filename)" are the AUTHORITATIVE source of truth for the document
- Document filenames like "240304 Blood Test" mean the date is "04 Mar 2024" (240304 = YYMMDD format = 24/03/04)
- ALWAYS use the date marked "(from filename)" as the primary date for that document
- **IMPORTANT**: A single document may contain data from MULTIPLE years. For example, a 2024 document may show:
  - Current 2024 test results (primary date from filename)
  - Historical 2023 data (for comparison)
  - Historical 2022 data (for comparison)
- When extracting data, look for ALL years mentioned in the context, not just the filename year
- If you see HDL data from 2022, 2023, and 2024 in the same document, include ALL of them in your table
- **Tables with multiple date columns**: Lab reports often have one row per test with SEVERAL date columns (e.g. "Date: 26/02/24 26/07/23 06/09/22" with values "54 51 44"). You MUST create ONE ROW PER DATE COLUMN: e.g. 26 Feb 2024 → 54, 26 Jul 2023 → 51, 06 Sep 2022 → 44. Do not only report the first or last column; the MIDDLE column(s) must also get their own row (e.g. 26 Jul 2023 must never be skipped)
- The filename date (e.g., "04 Mar 2024") is the date the document was created/test was taken
- Historical data within the document should be included with their respective years (2022, 2023, etc.)
- When a chunk has "Date: 04 Mar 2024 (from filename)", that is the document date, but adjacent chunks may contain historical data from other years

**CRITICAL REMINDER**: 
- Documents often contain historical data. A 2024 document may show 2022, 2023, AND 2024 data in adjacent chunks
- You MUST extract and include data from ALL years mentioned in the context, regardless of the document filename year
- If you see HDL values with years 2022, 2023, 2024 in the same document, include ALL of them in your table
- Missing any year that appears in the context is a SEVERE ERROR

Example when a document has a table with THREE date columns (26/02/24 26/07/23 06/09/22) and HDL values 54 51 44 - you MUST include all three rows:
| Date | Value (mg/dL) | Reference Range | Source |
|------|---------------|-----------------|--------|
| 06 Sep 2022 | 44 | 40 - 59 | Document: 240226 Blood Test General.pdf |
| 26 Jul 2023 | 51 | 40 - 59 | Document: 240226 Blood Test General.pdf |
| 26 Feb 2024 | 54 | 40 - 59 | Document: 240226 Blood Test General.pdf |
(Do not skip 26 Jul 2023; every date column gets one row.)

**Tone and Style:**
- Conversational and friendly
- Explain medical terms in plain English
- Highlight trends and patterns
- Provide context for what values mean
- Be actionable when appropriate
- Acknowledge gaps in data explicitly

**Context from Brian's documents:**
${optimizedContext}

**REMEMBER**: Consistency is critical. Every time you're asked the same question, you should give the SAME answer with the SAME data points. Only include data that exists in the context above. For test/lab queries (HDL, LDL, etc.), always give the full list of all dates and readings regardless of whether the user said "what's my X" or "list all dates and readings for X".
`
    }
  ];

  // Add conversation history
  history.forEach(msg => {
    if (msg.role === "user" || msg.role === "assistant") {
      conversationMessages.push({
        role: msg.role,
        content: msg.content
      });
    }
  });

  // Add current question with explicit instructions (for test queries, reinforce "complete list" so phrasing doesn't change result)
  const testQueryReminder = isTestQueryContext
    ? "\n- This is a test/lab query: return the COMPLETE list of ALL dates and readings (same as 'list all dates and readings for [this test]'); do not summarize or omit any row."
    : "";
  conversationMessages.push({
    role: "user",
    content: `${question}

CRITICAL REMINDERS FOR THIS RESPONSE:
- Only use dates from the available dates list provided in the system prompt
- Only reference documents from the file list in the system prompt
- For test queries (HDL, LDL, etc.): Extract ALL instances from context, deduplicate by date+value, sort chronologically
- Tables with multiple date columns (e.g. 26/02/24 26/07/23 06/09/22): output ONE ROW PER COLUMN - do not skip the middle column (e.g. 26 Jul 2023 must appear as its own row)
- Present data in markdown tables with Date | Value | Reference Range | Source columns
- If the same question has been asked before in this conversation, your answer MUST be identical
- NEVER create or infer data for years/dates not explicitly in the context${testQueryReminder}`
  });

  const totalTokens = conversationMessages.reduce((sum, msg) => 
    sum + estimateTokens(msg.content), 0
  );
  console.log(`📊 Estimated input tokens: ${totalTokens}`);
  
  // Check if optimizedContext contains 2024 documents
  const has240226Documents = 
  chunks.some(c => {
    return c.document_name && c.document_name.includes('240226');
  });

  if (has240226Documents) {
    console.log('\n📄 ========== OPTIMIZED CONTEXT (2024 Documents) ==========');
    console.log(optimizedContext);
    console.log('📄 ========== END OPTIMIZED CONTEXT ==========\n');
  }
  
  // 🔥 CRITICAL: Use consistent parameters for deterministic output
  const response = await client.chat.completions.create({
    model: "gpt-4-turbo-preview",
    messages: conversationMessages,
    temperature: 0, // 🔥 Changed from 0.1 to 0 for maximum determinism
    max_tokens: 4000,
    seed: 42,
    top_p: 1, // 🔥 Explicitly set top_p for determinism
  });

  let answer = response.choices[0].message.content;
  
  // Post-process validation
  answer = validateDatesInResponse(answer, availableDates);
  
  return answer;
}

// Helper to validate dates and log warnings
function validateDatesInResponse(response, availableDates) {
  if (!response || availableDates.length === 0) return response;
  
  // Extract all years mentioned (4-digit)
  const yearPattern = /\b(19|20)\d{2}\b/g;
  const mentionedYears = new Set();
  let match;
  while ((match = yearPattern.exec(response)) !== null) {
    mentionedYears.add(match[0]);
  }
  
  // Extract all dates mentioned
  const datePatterns = [
    /\b\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4}\b/gi,
    /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}\b/gi,
    /\b\d{1,2}\/\d{1,2}\/\d{4}\b/g
  ];
  
  const mentionedDates = new Set();
  datePatterns.forEach(pattern => {
    let dateMatch;
    while ((dateMatch = pattern.exec(response)) !== null) {
      mentionedDates.add(dateMatch[0].toLowerCase());
    }
  });
  
  // Check for hallucinated dates
  const invalidDates = [];
  mentionedYears.forEach(year => {
    const yearInContext = availableDates.some(d => d.includes(year));
    if (!yearInContext) {
      invalidDates.push(year);
    }
  });
  
  if (invalidDates.length > 0) {
    console.error(`❌ HALLUCINATION DETECTED: Response mentions dates not in context: ${invalidDates.join(', ')}`);
    console.error(`   Available dates were: ${availableDates.slice(0, 20).join(', ')}...`);
    // In production, you might want to reject this response and retry
  }
  
  return response;
}

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ 
    status: "healthy", 
    timestamp: new Date().toISOString(),
    uploadsDir: path.join(__dirname, 'uploads'),
    knowledgePath: path.join(__dirname, 'data', 'knowledge.json')
  });
});

// Cleanup endpoint (optional, for development)
app.post("/cleanup", async (req, res) => {
  try {
    // Clean empty or orphaned files in uploads
    const files = await fs.readdir('uploads');
    for (const file of files) {
      const filePath = path.join('uploads', file);
      const stats = await fs.stat(filePath);
      if (stats.size === 0) {
        await fs.remove(filePath);
        console.log(`Removed empty file: ${file}`);
      }
    }
    res.json({ message: "Cleanup completed" });
  } catch (err) {
    console.error("Cleanup error:", err);
    res.status(500).json({ error: "Cleanup failed" });
  }
});


export const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);


app.post("/upload-and-ingest", upload.single("file"), async (req, res) => {
  let tempFilePath = null;
  let storagePath = null;
  let docId = null;
  
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    docId = uuidv4();
    const fileName = req.file.originalname || `unnamed-${docId}.pdf`;
    tempFilePath = req.file.path;

    console.log(`\n${"=".repeat(60)}`);
    console.log(`Starting upload for: ${fileName}`);
    console.log(`Document ID: ${docId}`);
    console.log(`${"=".repeat(60)}\n`);

    // 1. Read the uploaded file
    console.log('📄 Step 1: Reading file...');
    const buffer = await fs.readFile(tempFilePath);
    console.log(`✓ File read: ${(buffer.length / 1024).toFixed(2)} KB`);

    // 2. Upload to Supabase storage
    console.log('\n☁️  Step 2: Uploading to Supabase storage...');
    storagePath = `pdfs/${docId}-${fileName}`;
    const { error: uploadError } = await supabase.storage
      .from("pdfs")
      .upload(storagePath, buffer, {
        contentType: "application/pdf",
        upsert: false
      });

    if (uploadError) {
      console.error("❌ Supabase upload error:", uploadError);
      throw new Error(`Storage upload failed: ${uploadError.message}`);
    }
    console.log(`✓ Uploaded to storage: ${storagePath}`);

    // 3. Extract text with OCR
    console.log('\n📝 Step 3: Extracting text with OCR...');
    
    const rawText = normalizeOCR(await extractTextWithOCR(buffer));
    console.log(`✓ Text extracted: ${rawText.length} characters`);
    
    if (rawText.length === 0) {
      throw new Error("No text could be extracted from PDF");
    }

    // Log first 500 chars to check for duplicates
    console.log('\n📋 Text preview (first 500 chars):');
    console.log(rawText.substring(0, 500));
    console.log('...\n');

    // 4. Chunk text
    console.log('\n✂️  Step 4: Chunking text...');
    const allChunks = chunkText(rawText);
    console.log(`✓ Created ${allChunks.length} raw chunks`);
    
    // 5. DEDUPLICATE CHUNKS
    console.log('\n🔍 Step 5: Removing duplicates...');
    const uniqueChunks = deduplicateChunks(allChunks);
    console.log(`✓ After deduplication: ${uniqueChunks.length} unique chunks`);
    console.log(`   (removed ${allChunks.length - uniqueChunks.length} duplicates)`);
    
    if (uniqueChunks.length === 0) {
      throw new Error("No valid chunks after deduplication");
    }
    
    // Limit chunks for faster processing
    const chunks = uniqueChunks;
    console.log(`📦 Processing ${chunks.length} chunks (limited from ${uniqueChunks.length})`);

    // Log first few chunks to verify they're different
    console.log('\n📝 Sample chunks:');
    chunks.slice(0, 3).forEach((chunk, i) => {
      console.log(`   Chunk ${i + 1}: ${chunk.substring(0, 80)}...`);
    });
    console.log();

    // 6. Insert document record
    console.log('\n💾 Step 6: Creating document record...');
    const { data: docData, error: docError } = await supabase
      .from("documents")
      .insert({
        id: docId,
        name: fileName,
        dropbox_path: storagePath
      })
      .select()
      .single();

    if (docError) {
      console.error("❌ Document insert error:", docError);
      throw new Error(`Failed to create document: ${docError.message}`);
    }
    console.log(`✓ Document record created`);

    // 7. Embed and insert chunks in batches
    console.log('\n🧠 Step 7: Embedding and inserting chunks...');
    const batchSize = 10;
    let totalInserted = 0;
    let totalFailed = 0;

    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize);
      const batchNum = Math.floor(i / batchSize) + 1;
      const totalBatches = Math.ceil(chunks.length / batchSize);
      
      console.log(`\n   Batch ${batchNum}/${totalBatches} (${batch.length} chunks)`);
      
      try {
        // Embed all chunks in this batch in parallel
        console.log(`   - Generating embeddings...`);
        const batchResults = await Promise.all(
          batch.map(async (chunk, idx) => {
            try {
              const embedding = await embed(chunk.text);
              
              // Verify embedding is valid
              if (!Array.isArray(embedding) || embedding.length === 0) {
                console.error(`   ⚠️  Invalid embedding for chunk ${i + idx}`);
                return null;
              }
              
              // Extract dates from both chunk text and filename
              // Filename dates are authoritative - prioritize them and filter conflicting text dates
              const datesFromText = extractDates(chunk.text);
              const filenameDates = extractDatesFromFilename(fileName);
              const allDates = mergeDatesWithFilenamePriority(datesFromText, filenameDates);
              
              return {
                id: uuidv4(),
                document_id: docId,
                text: chunk.text,
                chunk_index: i + idx,
                dates: allDates,
                document_name: fileName, // 🔥 NEW: Store document name
                section_header: chunk.header, // 🔥 NEW: Store section header              
                embedding: embedding
              };
            } catch (embedError) {
              console.error(`   ❌ Embedding error for chunk ${i + idx}:`, embedError.message);
              return null;
            }
          })
        );
        
        // Filter out failed embeddings
        const validResults = batchResults.filter(r => r !== null);
        
        if (validResults.length === 0) {
          console.log(`   ⚠️  All embeddings failed for this batch`);
          totalFailed += batch.length;
          continue;
        }
        
        console.log(`   - Generated ${validResults.length}/${batch.length} embeddings`);
        console.log(`   - Inserting to database...`);
        
        // Insert this batch to Supabase
        const { data: insertedData, error: chunkError } = await supabase
          .from("chunks")
          .insert(validResults)
          .select();

        if (chunkError) {
          console.error(`   ❌ Chunk insert error:`, chunkError);
          totalFailed += validResults.length;
        } else {
          const inserted = insertedData?.length || 0;
          totalInserted += inserted;
          console.log(`   ✓ Inserted ${inserted} chunks`);
        }
        
      } catch (batchError) {
        console.error(`   ❌ Batch ${batchNum} failed:`, batchError.message);
        totalFailed += batch.length;
      }
      
      // Small delay between batches to avoid rate limits
      if (i + batchSize < chunks.length) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      
    }

    // 8. Clean up temporary file
    await fs.remove(tempFilePath);

    console.log(`\n${"=".repeat(60)}`);
    console.log(`✅ UPLOAD COMPLETE`);
    console.log(`   - Document: ${fileName}`);
    console.log(`   - Unique chunks: ${uniqueChunks.length}`);
    console.log(`   - Chunks inserted: ${totalInserted}`);
    console.log(`   - Chunks failed: ${totalFailed}`);
    console.log(`   - Duplicates removed: ${allChunks.length - uniqueChunks.length}`);
    console.log(`${"=".repeat(60)}\n`);

    if (totalInserted === 0) {
      throw new Error("No chunks were successfully embedded and inserted");
    }

    res.json({
      id: docId,
      name: fileName,
      chunks: totalInserted,
      failed: totalFailed,
      uniqueChunks: uniqueChunks.length,
      duplicatesRemoved: allChunks.length - uniqueChunks.length
    });

  } catch (err) {
    console.error(`\n${"=".repeat(60)}`);
    console.error(`❌ UPLOAD FAILED`);
    console.error(`Error: ${err.message}`);
    console.error(`${"=".repeat(60)}\n`);
    
    // Cleanup on error
    if (tempFilePath) {
      try {
        await fs.remove(tempFilePath);
        console.log("✓ Cleaned up temp file");
      } catch (cleanupErr) {
        console.error("Failed to cleanup temp file:", cleanupErr.message);
      }
    }
    
    if (storagePath) {
      try {
        await supabase.storage.from("pdfs").remove([storagePath]);
        console.log("✓ Cleaned up storage");
      } catch (cleanupErr) {
        console.error("Failed to cleanup storage:", cleanupErr.message);
      }
    }
    
    if (docId) {
      try {
        await supabase.from("chunks").delete().eq("document_id", docId);
        await supabase.from("documents").delete().eq("id", docId);
        console.log("✓ Cleaned up database records");
      } catch (cleanupErr) {
        console.error("Failed to cleanup database:", cleanupErr.message);
      }
    }
    
    res.status(500).json({ 
      error: err.message || "Upload and ingest failed"
    });
  }
});

// 1. Main upload endpoint - starts the upload and returns uploadId
app.post("/upload-and-ingest-stream", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const uploadId = uuidv4();
    
    // Initialize progress tracking
    uploadProgress.set(uploadId, {
      stage: 'start',
      progress: 0,
      message: 'Starting upload...',
      fileName: req.file.originalname
    });

    // Return upload ID immediately
    res.json({ 
      uploadId,
      fileName: req.file.originalname 
    });

    // Process upload in background
    processUploadInBackground(req.file, uploadId).catch(err => {
      console.error("Background upload error:", err);
      uploadProgress.set(uploadId, {
        stage: 'error',
        error: err.message,
        progress: 0
      });
    });

  } catch (err) {
    console.error("Upload initiation failed:", err);
    res.status(500).json({ error: err.message });
  }
});

// 2. SSE endpoint for progress updates
app.get("/upload-progress/:uploadId", (req, res) => {
  const { uploadId } = req.params;
  
  // Set up SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
  res.flushHeaders();

  console.log(`SSE connection established for upload: ${uploadId}`);

  // Send progress updates every 500ms
  const interval = setInterval(() => {
    const progress = uploadProgress.get(uploadId);
    
    if (!progress) {
      console.log(`No progress found for ${uploadId}, ending SSE`);
      clearInterval(interval);
      res.write(`data: ${JSON.stringify({ stage: 'error', error: 'Upload not found' })}\n\n`);
      res.end();
      return;
    }
    
    // Send progress update
    res.write(`data: ${JSON.stringify(progress)}\n\n`);
    
    // If complete or error, clean up
    if (progress.stage === 'complete' || progress.stage === 'error') {
      console.log(`Upload ${uploadId} finished with stage: ${progress.stage}`);
      clearInterval(interval);
      
      // Keep the progress for a bit longer for the client to receive it
      setTimeout(() => {
        uploadProgress.delete(uploadId);
        res.end();
      }, 2000);
    }
  }, 500);
  
  // Clean up on client disconnect
  req.on('close', () => {
    console.log(`SSE connection closed for upload: ${uploadId}`);
    clearInterval(interval);
  });
});

// 3. Background processing function
async function processUploadInBackground(file, uploadId) {
  let tempFilePath = file.path;
  let storagePath = null;
  let docId = null;
  
  // Helper to update progress
  const updateProgress = (data) => {
    const current = uploadProgress.get(uploadId) || {};
    uploadProgress.set(uploadId, {
      ...current,
      ...data,
      timestamp: Date.now()
    });
    console.log(`Progress update [${uploadId}]:`, data.stage, data.progress);
  };

  try {
    docId = uuidv4();
    const fileName = file.originalname || `unnamed-${docId}.pdf`;

    console.log(`\n${"=".repeat(60)}`);
    console.log(`Processing upload: ${fileName}`);
    console.log(`Upload ID: ${uploadId}`);
    console.log(`Document ID: ${docId}`);
    console.log(`${"=".repeat(60)}\n`);

    // 1. Read file
    updateProgress({ 
      stage: 'reading', 
      progress: 10, 
      message: 'Reading file...' 
    });
    
    const buffer = await fs.readFile(tempFilePath);
    console.log(`✓ File read: ${(buffer.length / 1024).toFixed(2)} KB`);

    // 2. Upload to storage
    updateProgress({ 
      stage: 'uploading', 
      progress: 20, 
      message: 'Uploading to cloud storage...' 
    });
    
    storagePath = `pdfs/${docId}-${fileName}`;
    const { error: uploadError } = await supabase.storage
      .from("pdfs")
      .upload(storagePath, buffer, {
        contentType: "application/pdf",
        upsert: false
      });

    if (uploadError) {
      throw new Error(`Storage upload failed: ${uploadError.message}`);
    }
    console.log(`✓ Uploaded to storage: ${storagePath}`);

    // 3. Extract text with OCR
    updateProgress({ 
      stage: 'ocr', 
      progress: 30, 
      message: 'Starting OCR extraction...',
      currentPage: 0,
      totalPages: 0,
      pageProgress: 0
    });
    
    const rawText = normalizeOCR(
      await extractTextWithOCR(buffer, (ocrProgressData) => {
        updateProgress({
          stage: 'ocr',
          progress: 30 + (ocrProgressData.overallProgress * 0.3), // OCR: 30-60%
          currentPage: ocrProgressData.currentPage,
          totalPages: ocrProgressData.totalPages,
          pageProgress: ocrProgressData.pageProgress,
          message: ocrProgressData.message
        });
      })
    );
    
    console.log(`✓ Text extracted: ${rawText.length} characters`);
    
    if (rawText.length === 0) {
      throw new Error("No text could be extracted from PDF");
    }

    // 4. Chunking
    updateProgress({ 
      stage: 'chunking', 
      progress: 60, 
      message: 'Processing text...' 
    });
    
    const allChunks = chunkText(rawText);
    const uniqueChunks = deduplicateChunks(allChunks);
    
    console.log(`✓ Created ${allChunks.length} raw chunks`);
    console.log(`✓ After deduplication: ${uniqueChunks.length} unique chunks`);
    
    if (uniqueChunks.length === 0) {
      throw new Error("No valid chunks after deduplication");
    }
    
    const chunks = uniqueChunks;
    console.log(`📦 Processing ${chunks.length} chunks`);

    // 5. Create document
    updateProgress({ 
      stage: 'database', 
      progress: 65, 
      message: 'Creating document record...' 
    });
    
    const { data: docData, error: docError } = await supabase
      .from("documents")
      .insert({
        id: docId,
        name: fileName,
        dropbox_path: storagePath
      })
      .select()
      .single();

    if (docError) {
      throw new Error(`Failed to create document: ${docError.message}`);
    }
    console.log(`✓ Document record created`);

    // 6. Embedding with progress
    updateProgress({ 
      stage: 'embedding', 
      progress: 70, 
      message: 'Generating embeddings...',
      chunksProcessed: 0,
      totalChunks: chunks.length
    });
    
    const batchSize = 20;
    let totalInserted = 0;
    let totalFailed = 0;
    const totalBatches = Math.ceil(chunks.length / batchSize);

    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize);
      const batchNum = Math.floor(i / batchSize) + 1;
      
      // Calculate embedding progress (70-95%)
      const embeddingProgress = 70 + ((batchNum / totalBatches) * 25);
      
      updateProgress({ 
        stage: 'embedding', 
        progress: embeddingProgress,
        message: `Embedding batch ${batchNum}/${totalBatches}...`,
        chunksProcessed: i,
        totalChunks: chunks.length
      });

      console.log(`\n   Batch ${batchNum}/${totalBatches} (${batch.length} chunks)`);

      try {
        console.log(`   - Generating embeddings...`);
        const batchResults = await Promise.all(
          batch.map(async (chunk, idx) => {
            try {
              const embedding = await embed(chunk.text);
              
              if (!Array.isArray(embedding) || embedding.length === 0) {
                console.error(`   ⚠️  Invalid embedding for chunk ${i + idx}`);
                return null;
              }
              
              // Extract dates from both chunk text and filename
              // Filename dates are authoritative - prioritize them and filter conflicting text dates
              const datesFromText = extractDates(chunk.text);
              const filenameDates = extractDatesFromFilename(fileName);
              const allDates = mergeDatesWithFilenamePriority(datesFromText, filenameDates);
              
              return {
                id: uuidv4(),
                document_id: docId,
                text: chunk.text,
                chunk_index: i + idx,
                dates: allDates,
                document_name: fileName, // 🔥 NEW: Store document name
                section_header: chunk.header, // 🔥 NEW: Store section header              
                embedding: embedding
              };
            } catch (embedError) {
              console.error(`   ❌ Embedding error for chunk ${i + idx}:`, embedError.message);
              return null;
            }
          })
        );
        
        const validResults = batchResults.filter(r => r !== null);
        
        if (validResults.length === 0) {
          console.log(`   ⚠️  All embeddings failed for this batch`);
          totalFailed += batch.length;
          continue;
        }
        
        console.log(`   - Generated ${validResults.length}/${batch.length} embeddings`);
        console.log(`   - Inserting to database...`);
        
        const { data: insertedData, error: chunkError } = await supabase
          .from("chunks")
          .insert(validResults)
          .select();

        if (chunkError) {
          console.error(`   ❌ Chunk insert error:`, chunkError);
          totalFailed += validResults.length;
        } else {
          const inserted = insertedData?.length || 0;
          totalInserted += inserted;
          console.log(`   ✓ Inserted ${inserted} chunks`);
        }
        
      } catch (batchError) {
        console.error(`   ❌ Batch ${batchNum} failed:`, batchError.message);
        totalFailed += batch.length;
      }
      
      if (i + batchSize < chunks.length) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }

    // 7. Cleanup
    await fs.remove(tempFilePath);
    console.log("✓ Cleaned up temp file");

    // 8. Complete
    updateProgress({ 
      stage: 'complete', 
      progress: 100,
      message: 'Upload complete!',
      result: {
        id: docId,
        name: fileName,
        chunks: totalInserted,
        failed: totalFailed,
        uniqueChunks: uniqueChunks.length,
        duplicatesRemoved: allChunks.length - uniqueChunks.length
      }
    });

    console.log(`\n${"=".repeat(60)}`);
    console.log(`✅ UPLOAD COMPLETE`);
    console.log(`   - Document: ${fileName}`);
    console.log(`   - Chunks inserted: ${totalInserted}`);
    console.log(`   - Chunks failed: ${totalFailed}`);
    console.log(`${"=".repeat(60)}\n`);

    if (totalInserted === 0) {
      throw new Error("No chunks were successfully embedded and inserted");
    }

  } catch (err) {
    console.error(`\n${"=".repeat(60)}`);
    console.error(`❌ UPLOAD FAILED`);
    console.error(`Error: ${err.message}`);
    console.error(`${"=".repeat(60)}\n`);
    
    updateProgress({
      stage: 'error',
      error: err.message,
      progress: 0
    });
    
    // Cleanup on error
    if (tempFilePath) {
      try {
        await fs.remove(tempFilePath);
        console.log("✓ Cleaned up temp file");
      } catch (cleanupErr) {
        console.error("Failed to cleanup temp file:", cleanupErr.message);
      }
    }
    
    if (storagePath) {
      try {
        await supabase.storage.from("pdfs").remove([storagePath]);
        console.log("✓ Cleaned up storage");
      } catch (cleanupErr) {
        console.error("Failed to cleanup storage:", cleanupErr.message);
      }
    }
    
    if (docId) {
      try {
        await supabase.from("chunks").delete().eq("document_id", docId);
        await supabase.from("documents").delete().eq("id", docId);
        console.log("✓ Cleaned up database records");
      } catch (cleanupErr) {
        console.error("Failed to cleanup database:", cleanupErr.message);
      }
    }
  }
}



app.get("/files", async (req, res) => {
  const { data, error } = await supabase
    .from("documents")
    .select(`
      id,
      name,
      chunks(count)
    `);

  if (error) return res.status(500).json({ error: error.message });

  res.json(
    data.map(d => ({
      id: d.id,
      name: d.name,
      chunks: d.chunks[0]?.count ?? 0
    }))
  );
});



// Error handling middleware
app.use((err, req, res, next) => {
  console.error("Server error:", err);
  res.status(500).json({ 
    error: "Internal server error",
    message: err.message 
  });
});

const PORT = process.env.PORT || 5001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Uploads directory: ${path.join(__dirname, 'uploads')}`);
  console.log(`Knowledge data: ${path.join(__dirname, 'data', 'knowledge.json')}`);
});