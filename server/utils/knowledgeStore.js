
import fs from 'fs-extra';
import path from "path";
import { exec } from 'child_process';
import util from 'util';
const execAsync = util.promisify(exec);

const KNOWLEDGE_PATH = path.resolve("data/knowledge.json");

export async function loadKnowledge() {
  if (!(await fs.pathExists(KNOWLEDGE_PATH))) {
    await fs.writeJson(KNOWLEDGE_PATH, []);
  }
  return fs.readJson(KNOWLEDGE_PATH);
}


// Save uploaded file to knowledge.json
export async function savePdfToKnowledge(file, chunks = []) {
  // Load existing knowledge
  const knowledge = await fs.readJson(KNOWLEDGE_PATH).catch(() => []);

  // Filter out invalid chunks
  const validChunks = (chunks || [])
    .filter(c => c && c.toString().trim().length > 0)
    .map(c => ({
      id: crypto.randomUUID(),
      text: c.toString(),
      embedding: null, // or generate embedding later
    }));

  const newEntry = {
    id: crypto.randomUUID(),
    name: file.originalname,
    data: file.buffer ? file.buffer.toString('base64') : null, // store PDF base64 if buffer exists
    chunks: validChunks,
    createdAt: new Date().toISOString()
  };

  knowledge.push(newEntry);

  await fs.writeJson(KNOWLEDGE_PATH, knowledge, { spaces: 2 });

  return newEntry;
}

// Commit + push + fly deploy
export async function commitAndDeploy() {
  try {
    console.log("Running git add...");
    await execAsync('git add data/knowledge.json');

    console.log("Running git commit...");
    await execAsync('git commit -m "Add new PDFs"');

    console.log("Running git push...");
    await execAsync('git push');

    console.log("Running fly deploy...");
    await execAsync('fly deploy');

    console.log("✅ Knowledge updated and deployed successfully!");
  } catch (err) {
    console.error("❌ Failed to commit/deploy:", err.message);
  }
}
