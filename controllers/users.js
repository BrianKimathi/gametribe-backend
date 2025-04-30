const { db } = require("../config/firebase");

// Get user profile
const getUserProfile = async (req, res) => {
  try {
    const userId = req.user.uid; // From the verified token
    const userRef = db.collection("users").doc(userId);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      // If the user document doesn't exist, create a basic one
      const newUser = {
        uid: userId,
        email: req.user.email,
        username: req.user.email.split("@")[0], // Default username from email
        avatar: "", // Default empty avatar
        createdAt: new Date().toISOString(),
      };
      await userRef.set(newUser);
      return res.status(200).json(newUser);
    }

    return res.status(200).json(userDoc.data());
  } catch (error) {
    console.error("Error fetching user profile:", error);
    return res.status(500).json({ error: "Failed to fetch user profile" });
  }
};

// Update user profile
const updateUserProfile = async (req, res) => {
  try {
    const userId = req.user.uid;
    const { username, avatar } = req.body;

    if (!username && !avatar) {
      return res
        .status(400)
        .json({ error: "At least one field (username or avatar) is required" });
    }

    const userRef = db.collection("users").doc(userId);
    const updateData = {};
    if (username) updateData.username = username;
    if (avatar) updateData.avatar = avatar;

    await userRef.update(updateData);
    return res.status(200).json({ message: "Profile updated successfully" });
  } catch (error) {
    console.error("Error updating user profile:", error);
    return res.status(500).json({ error: "Failed to update user profile" });
  }
};

// Get user's clans
const getUserClans = async (req, res) => {
  try {
    const userId = req.user.uid;
    const userClansRef = db.collection("users").doc(userId).collection("clans");
    const snapshot = await userClansRef.get();

    if (snapshot.empty) {
      return res.status(200).json([]);
    }

    const clans = [];
    for (const doc of snapshot.docs) {
      const clanRef = db.collection("clans").doc(doc.id);
      const clanDoc = await clanRef.get();
      if (clanDoc.exists) {
        clans.push({ id: clanDoc.id, ...clanDoc.data() });
      }
    }

    return res.status(200).json(clans);
  } catch (error) {
    console.error("Error fetching user clans:", error);
    return res.status(500).json({ error: "Failed to fetch user clans" });
  }
};

module.exports = { getUserProfile, updateUserProfile, getUserClans };
