import { createClient } from "@supabase/supabase-js";
import "dotenv/config";
import { extractDates, extractDatesFromFilename, mergeDatesWithFilenamePriority } from "./helper.js";

// Initialize Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function migrateChunkDates() {
  console.log("🚀 Starting date migration...\n");

  try {
    // 1. Fetch all chunks with their document names
    console.log("📥 Fetching all chunks from database...");
    const { data: chunks, error: fetchError } = await supabase
      .from("chunks")
      .select("id, text, dates, document_name, document_id")
      .order("document_id", { ascending: true })
      .order("chunk_index", { ascending: true });

    if (fetchError) {
      throw new Error(`Failed to fetch chunks: ${fetchError.message}`);
    }

    if (!chunks || chunks.length === 0) {
      console.log("✅ No chunks found to migrate.");
      return;
    }

    console.log(`📊 Found ${chunks.length} chunks to process\n`);

    // 2. Group chunks by document to process efficiently
    const chunksByDocument = {};
    chunks.forEach(chunk => {
      const docId = chunk.document_id;
      if (!chunksByDocument[docId]) {
        chunksByDocument[docId] = [];
      }
      chunksByDocument[docId].push(chunk);
    });

    const documentIds = Object.keys(chunksByDocument);
    console.log(`📁 Processing ${documentIds.length} documents\n`);

    let totalUpdated = 0;
    let totalSkipped = 0;
    let totalErrors = 0;

    // 3. Process each document
    for (let i = 0; i < documentIds.length; i++) {
      const docId = documentIds[i];
      const docChunks = chunksByDocument[docId];
      const fileName = docChunks[0]?.document_name || "Unknown";

      console.log(`\n📄 Document ${i + 1}/${documentIds.length}: ${fileName}`);
      console.log(`   Processing ${docChunks.length} chunks...`);

      // Extract filename dates once per document
      const filenameDates = extractDatesFromFilename(fileName);
      
      if (filenameDates.primaryDate) {
        console.log(`   ✓ Filename date: ${filenameDates.primaryDate} (year: ${filenameDates.primaryYear})`);
      } else {
        console.log(`   ⚠️  No date found in filename`);
      }

      // 4. Update each chunk in this document
      for (const chunk of docChunks) {
        try {
          // Get current dates
          const currentDates = chunk.dates || [];
          
          // Extract dates from chunk text
          const datesFromText = extractDates(chunk.text || '');
          
          // Merge with filename priority
          const mergedDates = mergeDatesWithFilenamePriority(datesFromText, filenameDates);
          
          // Check if dates need updating
          const currentDatesStr = JSON.stringify([...currentDates].sort());
          const mergedDatesStr = JSON.stringify([...mergedDates].sort());
          
          if (currentDatesStr === mergedDatesStr) {
            totalSkipped++;
            continue; // No change needed
          }

          // Update chunk
          const { error: updateError } = await supabase
            .from("chunks")
            .update({ dates: mergedDates })
            .eq("id", chunk.id);

          if (updateError) {
            console.error(`   ❌ Error updating chunk ${chunk.id}: ${updateError.message}`);
            totalErrors++;
          } else {
            totalUpdated++;
            if (totalUpdated % 10 === 0) {
              process.stdout.write(`   ✓ Updated ${totalUpdated} chunks...\r`);
            }
          }
        } catch (chunkError) {
          console.error(`   ❌ Error processing chunk ${chunk.id}: ${chunkError.message}`);
          totalErrors++;
        }
      }
    }

    console.log(`\n\n${"=".repeat(60)}`);
    console.log("✅ MIGRATION COMPLETE");
    console.log(`${"=".repeat(60)}`);
    console.log(`   Total chunks processed: ${chunks.length}`);
    console.log(`   Chunks updated: ${totalUpdated}`);
    console.log(`   Chunks skipped (no change): ${totalSkipped}`);
    console.log(`   Errors: ${totalErrors}`);
    console.log(`${"=".repeat(60)}\n`);

  } catch (err) {
    console.error("\n❌ Migration failed:", err.message);
    console.error(err);
    process.exit(1);
  }
}

// Run migration
migrateChunkDates()
  .then(() => {
    console.log("✅ Migration script completed successfully");
    process.exit(0);
  })
  .catch((err) => {
    console.error("❌ Migration script failed:", err);
    process.exit(1);
  });
