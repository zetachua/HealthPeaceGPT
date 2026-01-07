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
import { deduplicateChunks, normalizeOCR } from "./helper.js";

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
    fileSize: 10 * 1024 * 1024, // 10MB limit
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
    // Get document info using correct column name
    const { data, error } = await supabase
      .from("documents")
      .select("dropbox_path")
      .eq("id", id)
      .single();

    if (error || !data || !data.dropbox_path) {
      return res.status(404).json({ error: "PDF not found" });
    }

    // Create signed URL
    const { data: signed, error: signError } = await supabase.storage
      .from("pdfs")
      .createSignedUrl(data.dropbox_path, 60);

    if (signError || !signed) {
      return res.status(500).json({ error: "Failed to generate signed URL" });
    }

    res.redirect(signed.signedUrl);
  } catch (err) {
    console.error("PDF serve error:", err);
    res.status(500).json({ error: err.message });
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
      .select("text")
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
async function generateAnswer(context, question) {
  const response = await client.responses.create({
    model: "gpt-4",
    input: [
      {
        role: "system",
        content: `You are HealthPeaceGPT, a friendly and supportive health information assistant for Brian Peace.
                - Always respond in a calm, conversational, and helpful tone.
                - Greet the user naturally if they say "hello" or similar.
                - Use only the information explicitly present in the provided reports.
                - Do NOT guess, speculate, or provide diagnoses or treatments.
                - If information is incomplete or unclear, say so constructively.
                - Explain medical terms in plain language.
                - Highlight uncertainties safely and suggest a qualified healthcare professional review them.
                - Summarize key findings clearly, using bullet points when helpful.

                Your goal: make the user feel guided, safe, and understood, even if some data is missing.
`
      },
      {
        role: "user",
        content: `Context:\n${context}\n\nQuestion:\n${question} Please answer clearly and concisely using bullet points where helpful. If there is uncertainty, explicitly state it.`
      }
    ]
  });

  return response.output_text;
}

app.post("/chat", async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) {
      return res.status(400).json({ error: "Message required" });
    }

    // 1. Embed query
    const queryEmbedding = await embed(message);

    // 2. Load chunks
    const { data: chunks, error } = await supabase
      .from("chunks")
      .select("text, embedding");

    if (error) throw error;
    if (!chunks || chunks.length === 0) {
      return res.json({
        answer: "No documents are available to answer this question."
      });
    }

    // 3. Score chunks
    const scoredChunks = chunks
      .map(c => {
        let embedding = c.embedding;

        // 🔥 Parse pgvector string → array
        if (typeof embedding === "string") {
          try {
            embedding = JSON.parse(embedding);
          } catch {
            return null;
          }
        }

        if (!Array.isArray(embedding)) return null;

        return {
          text: c.text,
          score: cosineSimilarity(queryEmbedding, embedding),
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score);

    // 🔍 DEBUG (keep this)
    console.log(
      scoredChunks.slice(0, 5).map(c => ({
        score: Number(c.score.toFixed(3)),
        preview: c.text.slice(0, 60)
      }))
    );

    // 4. Take TOP-K only
    const TOP_K = 12;
    const topChunks = scoredChunks.slice(0, TOP_K);

    const bestScore = topChunks[0]?.score ?? 0;

    // 5. Guard: no relevant info
    if (bestScore < 0.15) {
      return res.json({
        answer: "I couldn’t find relevant information in the uploaded documents to answer that question."
      });
    }

    // 6. Build context safely
    const context = topChunks.map(c => c.text).join("\n\n");

    // 7. Generate answer
    const answer = await generateAnswer(context, message);

    res.json({ answer });

  } catch (err) {
    console.error("Chat error:", err);
    res.status(500).json({ error: "Chat failed" });
  }
});

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
    const maxChunks = 100; // Increased limit since we have unique chunks now
    const chunks = uniqueChunks.slice(0, maxChunks);
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
              const embedding = await embed(chunk);
              
              // Verify embedding is valid
              if (!Array.isArray(embedding) || embedding.length === 0) {
                console.error(`   ⚠️  Invalid embedding for chunk ${i + idx}`);
                return null;
              }
              
              return {
                id: uuidv4(),
                document_id: docId,
                text: chunk,
                chunk_index: i + idx,
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
        await new Promise(resolve => setTimeout(resolve, 500));
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
