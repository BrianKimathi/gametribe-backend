const { db } = require("./config/firebase");

async function fixUsers() {
  try {
    const usersSnapshot = await db.collection("users").get();
    const batch = db.batch();
    usersSnapshot.docs.forEach((doc) => {
      const user = doc.data();
      if (!user.onlineStatus || !user.onlineStatus.lastActive) {
        batch.update(doc.ref, {
          onlineStatus: {
            isOnline: false,
            lastActive: new Date().toISOString(),
          },
        });
      }
    });
    await batch.commit();
    console.log("Users updated successfully");
  } catch (error) {
    console.error("Error updating users:", error);
  }
}

fixUsers();
