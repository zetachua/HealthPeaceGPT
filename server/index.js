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
import { deduplicateChunks, extractDates, normalizeOCR } from "./helper.js";

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
app.post("/chat", async (req, res) => {
  try {
    const { message, history = [] } = req.body;
    if (!message) {
      return res.status(400).json({ error: "Message required" });
    }

    // 🔥 NEW: Detect if user is searching by document name or date
    const isDocumentQuery = /\b(document|file|pdf|report)\b/i.test(message);
    const hasDateQuery = /\b(\d{4}|january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/i.test(message);
    
    // Extract potential document name from query
    const documentNameMatch = message.match(/(?:in|from|document|file|pdf)\s+["']?([^"']+)["']?/i);
    const queriedDocName = documentNameMatch ? documentNameMatch[1].trim() : null;
    
    // Extract potential dates from query
    const queriedDates = extractDates(message);

    // 1. Embed query
    const queryEmbedding = await embed(message);

    // 2. Load chunks WITH METADATA
    const { data: chunks, error } = await supabase
      .from("chunks")
      .select("text, embedding, document_id, dates, document_name, section_header");

    if (error) throw error;
    if (!chunks || chunks.length === 0) {
      return res.json({
        answer: "No documents are available to answer this question."
      });
    }

    // 3. Score chunks with HYBRID SCORING
    const scoredChunks = chunks
      .map(c => {
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
        
        // 🔥 BOOST SCORE if document name matches
        if (queriedDocName && c.document_name) {
          const docNameLower = c.document_name.toLowerCase();
          const queryNameLower = queriedDocName.toLowerCase();
          if (docNameLower.includes(queryNameLower) || queryNameLower.includes(docNameLower)) {
            score *= 1.5; // 50% boost for document name match
            console.log(`📄 Boosted score for document match: ${c.document_name}`);
          }
        }
        
        // 🔥 BOOST SCORE if section header matches
        if (c.section_header) {
          const headerLower = c.section_header.toLowerCase();
          const messageLower = message.toLowerCase();
          const headerWords = headerLower.split(/\s+/);
          const matchingWords = headerWords.filter(word => 
            word.length > 3 && messageLower.includes(word)
          );
          if (matchingWords.length > 0) {
            const headerBoost = 1 + (matchingWords.length * 0.2); // 20% boost per matching word
            score *= headerBoost;
            console.log(`📋 Boosted score for header match: ${c.section_header} (${headerBoost.toFixed(2)}x)`);
          }
        }
        
        // 🔥 BOOST SCORE if dates match
        if (queriedDates.length > 0 && c.dates && c.dates.length > 0) {
          const hasMatchingDate = queriedDates.some(qd => 
            c.dates.some(cd => cd.includes(qd) || qd.includes(cd))
          );
          if (hasMatchingDate) {
            score *= 1.3; // 30% boost for date match
            console.log(`📅 Boosted score for date match: ${c.dates.join(', ')}`);
          }
        }

        return {
          text: c.text,
          document_id: c.document_id,
          document_name: c.document_name,
          section_header: c.section_header,
          dates: c.dates,
          score: score,
        };
      })
      .filter(Boolean);

    // 🔥 GROUP BY DOCUMENT
    const byDoc = {};
    for (const c of scoredChunks) {
      byDoc[c.document_id] ||= [];
      byDoc[c.document_id].push(c);
    }

    // 🔥 TAKE TOP PER DOCUMENT (increased for better coverage)
    const balancedChunks = Object.values(byDoc)
      .flatMap(chunks =>
        chunks
          .sort((a, b) => b.score - a.score)
          .slice(0, 5) // Increased from 3 to 5
      )
      .sort((a, b) => b.score - a.score)
      .slice(0, 10); // Increased from 12 to 10

    // 🔍 DEBUG
    console.log('\n🔍 Top scored chunks:');
    balancedChunks.slice(0, 5).forEach((c, i) => {
      console.log(`${i + 1}. Score: ${c.score.toFixed(3)} | Doc: ${c.document_name} | Header: ${c.section_header || 'N/A'} | Dates: ${c.dates?.join(', ') || 'N/A'}`);
      console.log(`   Preview: ${c.text.slice(0, 80)}...`);
    });

    const bestScore = balancedChunks[0]?.score ?? 0;
    console.log(bestScore, "bestScore")

    if (bestScore < 0.1) {
      return res.json({
        answer: "I couldn't find relevant information in the uploaded documents to answer that question."
      });
    }

    // 6. Build context WITH METADATA
    const context = balancedChunks
      .map(c => {
        const metadata = [];
        if (c.document_name) metadata.push(`Document: ${c.document_name}`);
        if (c.section_header) metadata.push(`Section: ${c.section_header}`);
        if (c.dates && c.dates.length > 0) metadata.push(`Dates: ${c.dates.join(', ')}`);
        
        const metadataStr = metadata.length > 0 ? `[${metadata.join(' | ')}]\n` : '';
        return `${metadataStr}${c.text}`;
      })
      .join("\n\n");

    // 7. Generate answer WITH HISTORY
    const answer = await generateAnswerWithHistory(context, message, history);

    res.json({ answer });

  } catch (err) {
    console.error("Chat error:", err);
    res.status(500).json({ error: "Chat failed" });
  }
});

// Updated generateAnswer function with history support
async function generateAnswerWithHistory(context, question, history = []) {
  // Build conversation messages array
  const conversationMessages = [
    {
      role: "system",
      content: `You are HealthPeaceGPT, a friendly, insightful health assistant for Brian Peace.
            **Your Role:**
            You're not just summarizing data—you're helping Brian understand his health story.

            **When responding:**

            1. **Connect the dots**: Look for patterns across different test results and time periods
              - Example: "Your reflux diagnosis aligns with your previous digestive concerns"
              
            2. **Provide context**: Help Brian understand what results mean
              - Instead of: "HbA1c: 4.9%"
              - Say: "Your HbA1c of 4.9% is excellent—well below the 5.7% prediabetes threshold"

            3. **Prioritize**: What matters most? What needs attention?
              - Highlight concerning trends or positive improvements
              
            4. **Be actionable**: Suggest next steps when appropriate
              - "Based on your reflux diagnosis, you might consider..."
              - "Your improving cholesterol suggests your current approach is working"

            5. **Use conversational tone**: 
              - Write like you're talking to a friend, not filing a report
              - Use "you" and "your" naturally
              - Break complex medical terms into plain English

            6. **Show trends over time**: When multiple dates exist, highlight changes
              - "Your cholesterol dropped from X to Y—that's great progress!"
              
            7. **Acknowledge gaps**: If data is missing or unclear, say so
              - "I don't see recent blood pressure readings—worth checking at your next visit"

            **For summaries specifically:**
            - Start with the big picture ("Overall, your health shows...")
            - Group related findings (digestive health, metabolic health, musculoskeletal, etc.)
            - End with 2-3 key takeaways or action items

            **Format guidelines:**
            - Use markdown tables for comparing values over time
            - Use bullet points for lists
            - Bold key findings
            - Keep paragraphs short (2-3 sentences max)

            **Context from Brian's documents:**
            ${context}


      `
    }
  ];

  // Add conversation history (filter out any system messages or loading states)
  history.forEach(msg => {
    if (msg.role === "user" || msg.role === "assistant") {
      conversationMessages.push({
        role: msg.role,
        content: msg.content
      });
    }
  });

  // Add current question
  conversationMessages.push({
    role: "user",
    content: `${question}\n\nIMPORTANT: If this question asks about trends, multiple readings, or data over time, extract the dates and values and present them in a clear markdown table format.`
  });

  const response = await client.chat.completions.create({
    model: "gpt-4-turbo-preview",
    messages: conversationMessages,
    temperature: 0.7, // Slightly creative but consistent
    max_tokens: 1000, // Adjust based on your needs
  });

  return response.choices[0].message.content;
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
              
              return {
                id: uuidv4(),
                document_id: docId,
                text: chunk.text,
                chunk_index: i + idx,
                dates:extractDates(chunk.text),
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
              
              return {
                id: uuidv4(),
                document_id: docId,
                text: chunk.text,
                chunk_index: i + idx,
                dates:extractDates(chunk.text),
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
