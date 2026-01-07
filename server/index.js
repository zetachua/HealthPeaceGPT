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

    // 1. Embed user query
    const queryEmbedding = await embed(message);

    // 2. Load chunks from Supabase
    const { data: chunks, error } = await supabase
      .from("chunks")
      .select("text, embedding");

    if (error) {
      throw error;
    }

    // 3. Score chunks
    const scoredChunks = chunks
      .filter(c => Array.isArray(c.embedding) && c.embedding.length > 0)
      .map(c => ({
        text: c.text,
        score: cosineSimilarity(queryEmbedding, c.embedding)
      }));

    // 4. Select top K
    const topChunks = scoredChunks
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    const context = topChunks.map(c => c.text).join("\n\n");

    // 5. Generate answer
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

    console.log(`=== Starting upload for: ${fileName} ===`);
    console.log(`Document ID: ${docId}`);

    // 1. Read the uploaded file
    console.log('Step 1: Reading file...');
    const buffer = await fs.readFile(tempFilePath);
    console.log(`✓ File read: ${buffer.length} bytes`);

    // 2. Upload to Supabase storage
    console.log('Step 2: Uploading to Supabase storage...');
    storagePath = `pdfs/${docId}-${fileName}`;
    const { error: uploadError } = await supabase.storage
      .from("pdfs")
      .upload(storagePath, buffer, {
        contentType: "application/pdf",
        upsert: false
      });

    if (uploadError) {
      console.error("Supabase upload error:", uploadError);
      throw new Error(`Storage upload failed: ${uploadError.message}`);
    }

    console.log(`✓ Uploaded to storage: ${storagePath}`);

    // 3. Extract text with OCR
    console.log('Extracting text...');
    const rawText = await extractTextWithOCR(buffer);
    console.log(`✓ Text extracted: ${rawText.length} characters`);

    // 4. Chunk text - LIMIT TO 30 CHUNKS for faster processing
    console.log('Chunking text...');
    const allChunks = chunkText(rawText);
    const chunks = allChunks.slice(0, 30); // Reduced from 50 to 30
    console.log(`✓ Processing ${chunks.length} chunks (out of ${allChunks.length} total)`);

    // 5. Insert document record
    const { data: docData, error: docError } = await supabase
      .from("documents")
      .insert({
        id: docId,
        name: fileName,
        storage_path: storagePath
      })
      .select()
      .single();

    if (docError) {
      console.error("Document insert error:", docError);
      console.error("Error details:", JSON.stringify(docError, null, 2));
      // Clean up storage
      await supabase.storage.from("pdfs").remove([storagePath]);
      await fs.remove(filePath);
      return res.status(500).json({ 
        error: "Failed to create document record",
        details: docError.message 
      });
    }

    console.log('✓ Document record created');

    // 6. Embed chunks in LARGER batches for speed
    console.log('Embedding chunks...');
    const batchSize = 15; // Increased from 10 to 15 for faster processing
    const allRows = [];

    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize);
      const batchNum = Math.floor(i/batchSize) + 1;
      const totalBatches = Math.ceil(chunks.length/batchSize);
      
      console.log(`Processing batch ${batchNum}/${totalBatches} (${batch.length} chunks)`);
      
      // Embed all chunks in this batch in parallel
      const batchResults = await Promise.all(
        batch.map(async (chunk, idx) => ({
          id: uuidv4(),
          document_id: docId,
          text: chunk,
          chunk_index: i + idx,
          embedding: await embed(chunk)
        }))
      );
      
      allRows.push(...batchResults);
      
      // Insert this batch to Supabase
      const { error: chunkError } = await supabase
        .from("chunks")
        .insert(batchResults);

      if (chunkError) {
        console.error("Chunk insert error:", chunkError);
        // Continue with other batches even if one fails
      } else {
        console.log(`✓ Batch ${batchNum} inserted`);
      }
    }

    // 7. Clean up temporary file
    await fs.remove(tempFilePath);

    console.log(`=== ✓ Upload complete: ${allRows.length} chunks processed ===`);

    res.json({
      id: docId,
      name: fileName,
      chunks: allRows.length,
      totalChunksAvailable: allChunks.length
    });

  } catch (err) {
    console.error("=== ✗ Upload and ingest failed ===");
    console.error("Error:", err);
    
    // Cleanup on error
    if (tempFilePath) {
      await fs.remove(tempFilePath).catch(() => {});
    }
    
    // Clean up Supabase storage if it was created
    if (storagePath) {
      await supabase.storage.from("pdfs").remove([storagePath]).catch(() => {});
    }
    
    // Clean up document record if it was created
    if (docId) {
      await supabase.from("documents").delete().eq("id", docId).catch(() => {});
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
