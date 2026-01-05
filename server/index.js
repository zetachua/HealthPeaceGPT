import "dotenv/config";
import multer from "multer";
import express from "express";
import cors from "cors";
import fs from "fs-extra";
import { v4 as uuidv4 } from "uuid";
import path from "path";
import { fileURLToPath } from "url";
import { extractText } from "./utils/extractText.js";
import { loadKnowledge,savePdfToKnowledge,commitAndDeploy } from "./utils/knowledgeStore.js";
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
app.post("/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const fileId = uuidv4();
    const filePath = req.file.path;
    const fileName = req.file.originalname || `unnamed-${fileId}.pdf`;;
    const buffer = await fs.readFile(filePath);

    // 1. Extract raw text
    const rawText = await extractText(filePath, req.file.mimetype, buffer);

    // 2. Chunk text
    const chunks = chunkText(rawText);
    console.log("Number of chunks:", chunks.length);

    // 3. Embed each chunk
    const embeddedChunks = await Promise.all(
      chunks.map(async (chunk) => ({
        id: uuidv4(),
        text: chunk,
        embedding: await embed(chunk),
      }))
    );

    // 4. Save the actual PDF file for viewing
    const pdfStoragePath = path.join('uploads', `${fileId}.pdf`);
    await fs.copy(filePath, pdfStoragePath);

    // 5. Save to knowledge.json
    const knowledge = await loadKnowledge();
    knowledge.push({
      id: fileId,
      name: fileName,
      createdAt: new Date().toISOString(),
      chunks: embeddedChunks
    });
    await savePdfToKnowledge(knowledge);

    // 6. Commit & deploy in background (non-blocking)
    commitAndDeploy().catch(err => console.error(err));

    // 7. Cleanup temporary uploaded file
    await fs.remove(filePath);

    res.status(200).json({
      id: fileId,
      name: fileName,
      chunks: embeddedChunks.length
    });

  } catch (err) {
    console.error("Upload failed:", err);

    // Cleanup on error
    if (req.file && req.file.path) {
      await fs.remove(req.file.path).catch(() => {});
    }

    res.status(500).json({ error: "File processing failed" });
  }
});

// Delete endpoint
app.delete("/delete/:id", async (req, res) => {
  try {
    const knowledge = await loadKnowledge();
    const fileToDelete = knowledge.find(f => f.id === req.params.id);
    
    if (!fileToDelete) {
      return res.status(404).json({ error: "File not found" });
    }

    const updated = knowledge.filter(f => f.id !== req.params.id);
    await saveKnowledge(updated);

    // Also delete the stored PDF file if it exists
    const pdfPath = path.join('uploads', `${req.params.id}.pdf`);
    if (await fs.pathExists(pdfPath)) {
      await fs.remove(pdfPath);
    }

    res.json({ success: true });
  } catch (err) {
    console.error("Delete error:", err);
    res.status(500).json({ error: "Failed to delete file" });
  }
});

// Get files list
app.get("/files", async (req, res) => {
  try {
    const knowledge = await loadKnowledge();
    res.json(
      knowledge.map(file => ({
        id: file.id,
        name: file.name,
        chunks: file.chunks?.length || 0,
        createdAt: file.createdAt
      }))
    );
  } catch (err) {
    console.error("Files list error:", err);
    res.status(500).json({ error: "Failed to fetch files" });
  }
});

// Serve PDF files
app.get("/pdf/:id", async (req, res) => {
  try {
    const pdfPath = path.join(__dirname, 'uploads', `${req.params.id}.pdf`);
    
    // Check if file exists
    if (!await fs.pathExists(pdfPath)) {
      return res.status(404).json({ 
        error: "PDF file not found",
        message: "The PDF file may have been deleted or not saved properly"
      });
    }

    // Check if it's a valid PDF file
    const stats = await fs.stat(pdfPath);
    if (stats.size === 0) {
      return res.status(404).json({ error: "PDF file is empty" });
    }

    // Set appropriate headers for PDF
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${req.params.id}.pdf"`);
    
    // Stream the PDF file
    const fileStream = fs.createReadStream(pdfPath);
    fileStream.pipe(res);
    
    // Handle stream errors
    fileStream.on('error', (err) => {
      console.error("PDF stream error:", err);
      res.status(500).json({ error: "Failed to stream PDF" });
    });

  } catch (err) {
    console.error("PDF serve error:", err);
    res.status(500).json({ error: "Failed to serve PDF" });
  }
});

// Alternative endpoint to get PDF content as text
app.get("/pdf-text/:id", async (req, res) => {
  try {
    const knowledge = await loadKnowledge();
    const file = knowledge.find(f => f.id === req.params.id);
    
    if (!file) {
      return res.status(404).json({ error: "PDF not found in database" });
    }

    // Return the extracted text from chunks
    const fullText = file.chunks?.map(c => c.text).join('\n\n') || "";
    
    res.json({
      id: file.id,
      name: file.name,
      content: fullText,
      chunksCount: file.chunks?.length || 0
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

    // 2. Load knowledge
    const knowledge = await loadKnowledge();

    // 3. Score all chunks
    const scoredChunks = knowledge.flatMap(file =>
      file.chunks
        .filter(c => c.embedding && c.embedding.length > 0) // skip broken chunks
        .map(chunk => ({
          text: chunk.text,
          score: cosineSimilarity(queryEmbedding, chunk.embedding)
        }))
    );
    
    // 4. Top K matches
    const topChunks = scoredChunks
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    const context = topChunks.map(c => c.text).join("\n\n");

    // 5. Call OpenAI (GPT-4)
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
