import "dotenv/config";
import multer from "multer";
import express from "express";
import cors from "cors";
import fs from "fs-extra";
import { v4 as uuidv4 } from "uuid";
import {extractText} from "./utils/extractText.js";
import { loadKnowledge, saveKnowledge } from "./utils/knowledgeStore.js";
import {chunkText} from "./utils/chunkText.js";
import { cosineSimilarity, embed } from "./utils/embedding.js";
console.log("ENV LOADED:", process.env.OPENAI_API_KEY?.slice(0, 5));

import OpenAI from "openai";

const app = express();
app.use(cors());
app.use(express.json());

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});


// 2. Configure Multer to handle file uploads
// Note: This simple configuration saves the file directly to memory (not recommended for production)
// For development, we'll keep it simple for now, but usually you'd configure disk storage.
const upload = multer({ dest: 'uploads/' }); 
// If you don't want to actually save the file yet:
// const upload = multer({ storage: multer.memoryStorage() });


app.get("/", (req, res) => {
  res.send("Server is running 👍");
});

// 3. ADD THE POST /upload ROUTE
// 'file' must match the name used in formData.append("file", selectedFile) in your React code
// app.post("/upload", upload.single("file"), (req, res) => {
//   if (!req.file) {
//     return res.status(400).send("No file uploaded.");
//   }
  
//   // In a real application, you would process or save req.file here.
//   // req.file contains information about the uploaded file.
  
//   console.log(`Received file: ${req.file.originalname}`); // Check your server terminal!

//   // Send a success response back to the frontend
//   res.status(200).json({ 
//     message: "File uploaded successfully!", 
//     id: Date.now(), // Use a temporary ID for testing
//     name: req.file.originalname // Send back the filename for your frontend to display
//   });
// });

app.post("/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const fileId = uuidv4();
    const filePath = req.file.path;
    const fileName = req.file.originalname;
    const buffer = await fs.readFile(filePath);
    // 1. Extract raw text
    const rawText = await extractText(filePath, req.file.mimetype,buffer);

    // 2. Chunk text
    const chunks = chunkText(rawText);
    console.log("Number of chunks:", chunks.length);

    // 3. Embed each chunk
    const embeddedChunks = [];
    for (const chunk of chunks) {
      const embedding = await embed(chunk);
      console.log("Chunk embedding length:", embedding.length);
      embeddedChunks.push({
        id: uuidv4(),
        text: chunk,
        embedding
      });
    }

    // 4. Save to knowledge.json
    const knowledge = await loadKnowledge();
    knowledge.push({
      id: fileId,
      name: fileName,
      createdAt: new Date().toISOString(),
      chunks: embeddedChunks
    });
    await saveKnowledge(knowledge);

    // 5. Cleanup uploaded file
    await fs.remove(filePath);

    res.status(200).json({
      id: fileId,
      name: fileName,
      chunks: embeddedChunks.length
    });

  } catch (err) {
    console.error("Upload failed:", err);
    res.status(500).json({ error: "File processing failed" });
  }
});


// 4. ADD THE DELETE ROUTE (for testing the frontend logic)
app.delete("/delete/:id", async (req, res) => {
  const knowledge = await loadKnowledge();
  const updated = knowledge.filter(f => f.id !== req.params.id);
  await saveKnowledge(updated);
  res.json({ success: true });
});

app.get("/files", async (req, res) => {
  const knowledge = await loadKnowledge();
  res.json(
    knowledge.map(file => ({
      id: file.id,
      name: file.name,
      chunks: file.chunks.length
    }))
  );
});


async function generateAnswer(context, question) {
  const response = await client.responses.create({
    model: "gpt-5",
    input: [
      {
        role: "system",
        content: `You are a health information assistant tasked with responding to the user with analysis of medical reports and notes of Brian Peace. 

          STRICT RULES:
          1. Use ONLY the information explicitly present in the provided reports.
          2. Do NOT guess, speculate, or add any external medical knowledge.
          3. Do NOT provide medical diagnoses, prescriptions, or treatment instructions.
          4. If the information in the report is incomplete, say so clearly.
          5. Present information in a calm, neutral, and factual tone.
          6. Explain medical terms and abbreviations in plain language whenever possible.
          7. When appropriate, suggest that the user consult a qualified healthcare professional for interpretation or next steps.

        Your task:
        - Analyze only the key, relevant findings for each organ/system or health topic.
        - Keep each point concise (1–2 sentences max).
        - Use a calm, conversational tone, as if explaining to a non-health expert.
        - Include follow-up recommendations or uncertainties inline, but do not add speculation.
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

    // 5. Call OpenAI (GPT-5)
    const answer = await generateAnswer(context, message);

    res.json({ answer });

  } catch (err) {
    console.error("Chat error:", err);
    res.status(500).json({ error: "Chat failed" });
  }
});

const PORT = process.env.PORT || 5001;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
