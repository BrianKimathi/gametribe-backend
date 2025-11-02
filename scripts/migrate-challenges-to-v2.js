/**
 * Migration script to move challenges from encrypted secureChallenges to unencrypted challenges
 * Run this once to migrate existing data
 */

const { database } = require("../config/firebase");
const { ref, get, set, remove } = require("firebase/database");
const { decryptData } = require("../utils/encryption");

const ENCRYPTION_KEY = process.env.CHALLENGE_ENCRYPTION_KEY;
if (!ENCRYPTION_KEY || ENCRYPTION_KEY.length < 32) {
  console.error(
    "❌ CHALLENGE_ENCRYPTION_KEY must be set and >= 32 characters"
  );
  process.exit(1);
}

async function migrateChallenges() {
  console.log("🔄 Starting challenge migration...");

  try {
    // Get all encrypted challenges
    const secureChallengesRef = ref(database, "secureChallenges");
    const snapshot = await get(secureChallengesRef);

    if (!snapshot.exists()) {
      console.log("✅ No challenges to migrate");
      return;
    }

    const encryptedChallenges = snapshot.val();
    const challengeIds = Object.keys(encryptedChallenges);
    console.log(`📦 Found ${challengeIds.length} challenges to migrate`);

    let successCount = 0;
    let errorCount = 0;

    // Migrate each challenge
    for (const challengeId of challengeIds) {
      try {
        console.log(`\n🔄 Migrating challenge: ${challengeId}`);

        // Decrypt the challenge
        const encryptedData = encryptedChallenges[challengeId];
        const decryptedData = decryptData(encryptedData, ENCRYPTION_KEY);

        console.log(`   Status: ${decryptedData.status}`);

        // Write to new challenges node (unencrypted)
        const newChallengeRef = ref(database, `challenges/${challengeId}`);
        await set(newChallengeRef, decryptedData);

        console.log(`   ✅ Migrated successfully`);

        successCount++;

        // Don't delete old data yet (keep as backup)
        // Uncomment when migration is verified
        // await remove(ref(database, `secureChallenges/${challengeId}`));
      } catch (error) {
        console.error(`   ❌ Error migrating ${challengeId}:`, error.message);
        errorCount++;
      }
    }

    console.log("\n" + "=".repeat(50));
    console.log("✅ Migration complete!");
    console.log(`   Successfully migrated: ${successCount}`);
    console.log(`   Errors: ${errorCount}`);
    console.log("=".repeat(50));

    if (successCount > 0) {
      console.log("\n⚠️  IMPORTANT:");
      console.log(
        "   Old encrypted data is still in secureChallenges as backup"
      );
      console.log(
        "   Review the migrated challenges, then manually delete secureChallenges"
      );
    }
  } catch (error) {
    console.error("❌ Migration failed:", error);
    process.exit(1);
  }
}

// Run migration
migrateChallenges()
  .then(() => {
    console.log("\n✅ Script completed successfully");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Script failed:", error);
    process.exit(1);
  });



