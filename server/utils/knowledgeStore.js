
import fs from 'fs-extra';
import path from "path";

const KNOWLEDGE_PATH = path.resolve("data/knowledge.json");

export async function loadKnowledge() {
  if (!(await fs.pathExists(KNOWLEDGE_PATH))) {
    await fs.writeJson(KNOWLEDGE_PATH, []);
  }
  return fs.readJson(KNOWLEDGE_PATH);
}

export async function saveKnowledge(data) {
  await fs.writeJson(KNOWLEDGE_PATH, data, { spaces: 2 });
}