const admin = require("firebase-admin");
const { db, database } = require("../config/firebase");

// Get user profile
const getUserProfile = async (req, res) => {
  try {
    const userId = req.user.uid;
    const userRef = db.collection("users").doc(userId);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      const newUser = {
        uid: userId,
        email: req.user.email,
        username: req.user.email.split("@")[0],
        avatar: req.user.picture || "",
        createdAt: new Date().toISOString(),
        friendsCount: 0,
      };
      await userRef.set(newUser);
      return res.status(200).json(newUser);
    }

    return res.status(200).json(userDoc.data());
  } catch (error) {
    console.error("Error fetching user profile:", {
      message: error.message,
      code: error.code,
      stack: error.stack,
    });
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
    console.error("Error updating user profile:", {
      message: error.message,
      code: error.code,
      stack: error.stack,
    });
    return res.status(500).json({ error: "Failed to update user profile" });
  }
};

// Get user's clans
const getUserClans = async (req, res) => {
  try {
    const userId = req.user.uid;
    const membershipsRef = db.collection(`users/${userId}/memberships`);
    const membershipsSnapshot = await membershipsRef.get();
    const clanIds = membershipsSnapshot.docs.map((doc) => doc.id);
    const clans = [];
    for (const clanId of clanIds) {
      const clanRef = db.collection("clans").doc(clanId);
      const clanDoc = await clanRef.get();
      if (clanDoc.exists) {
        clans.push({ id: clanDoc.id, ...clanDoc.data() });
      }
    }
    return res.status(200).json(clans);
  } catch (error) {
    console.error("Error fetching user clans:", {
      message: error.message,
      code: error.code,
      stack: error.stack,
    });
    return res.status(500).json({ error: "Failed to fetch user clans" });
  }
};

// Follow a user
const followUser = async (req, res) => {
  try {
    const { userId } = req.params; // User to follow
    const currentUserId = req.user.uid;

    if (currentUserId === userId) {
      return res.status(400).json({ error: "Cannot follow yourself" });
    }

    // Check if the user to follow exists
    const userRef = db.collection("users").doc(userId);
    const userDoc = await userRef.get();
    if (!userDoc.exists) {
      return res.status(404).json({ error: "User not found" });
    }
    const userData = userDoc.data();

    // Check if already following
    const friendRef = db
      .collection(`users/${currentUserId}/friends`)
      .doc(userId);
    const friendDoc = await friendRef.get();
    if (friendDoc.exists) {
      return res.status(400).json({ error: "Already following this user" });
    }

    // Add to friends subcollection
    await friendRef.set({
      uid: userId,
      username: userData.username || userData.email.split("@")[0],
      avatar: userData.avatar || userData.picture || "",
      followedAt: new Date().toISOString(),
    });

    // Update friends count
    await userRef.update({
      friendsCount: admin.firestore.FieldValue.increment(1),
    });

    return res.status(200).json({ message: "User followed successfully" });
  } catch (error) {
    console.error("Error following user:", {
      message: error.message,
      code: error.code,
      stack: error.stack,
    });
    return res.status(500).json({ error: "Failed to follow user" });
  }
};

// Unfollow a user
const unfollowUser = async (req, res) => {
  try {
    const { userId } = req.params; // User to unfollow
    const currentUserId = req.user.uid;

    if (currentUserId === userId) {
      return res.status(400).json({ error: "Cannot unfollow yourself" });
    }

    // Check if following
    const friendRef = db
      .collection(`users/${currentUserId}/friends`)
      .doc(userId);
    const friendDoc = await friendRef.get();
    if (!friendDoc.exists) {
      return res.status(400).json({ error: "Not following this user" });
    }

    // Remove from friends subcollection
    await friendRef.delete();

    // Update friends count
    const userRef = db.collection("users").doc(userId);
    await userRef.update({
      friendsCount: admin.firestore.FieldValue.increment(-1),
    });

    return res.status(200).json({ message: "User unfollowed successfully" });
  } catch (error) {
    console.error("Error unfollowing user:", {
      message: error.message,
      code: error.code,
      stack: error.stack,
    });
    return res.status(500).json({ error: "Failed to unfollow user" });
  }
};

// Get friends list
const getFriends = async (req, res) => {
  try {
    const userId = req.params.userId;
    const friendsRef = db.collection(`users/${userId}/friends`);
    const friendsSnapshot = await friendsRef.get();
    const friends = friendsSnapshot.docs.map((doc) => ({
      uid: doc.id,
      ...doc.data(),
    }));
    return res.status(200).json(friends);
  } catch (error) {
    console.error("Error fetching friends:", {
      message: error.message,
      code: error.code,
      stack: error.stack,
    });
    return res.status(500).json({ error: "Failed to fetch friends" });
  }
};

// Get user by ID
const getUserById = async (req, res) => {
  try {
    const { userId } = req.params;
    const userRef = db.collection("users").doc(userId);
    const userDoc = await userRef.get();
    if (!userDoc.exists) {
      return res.status(404).json({ error: "User not found" });
    }
    const userData = userDoc.data();
    return res.status(200).json({
      uid: userId,
      username: userData.username || userData.email.split("@")[0],
      avatar: userData.avatar || userData.picture || "",
    });
  } catch (error) {
    console.error("Error fetching user:", {
      message: error.message,
      code: error.code,
      stack: error.stack,
    });
    return res.status(500).json({ error: "Failed to fetch user" });
  }
};

// Get user status
const getUserStatus = async (req, res) => {
  try {
    const userId = req.params.userId;
    const userRef = db.collection("users").doc(userId);
    const userDoc = await userRef.get();
    if (!userDoc.exists) {
      return res.status(404).json({ error: "User not found" });
    }
    const userData = userDoc.data();
    const onlineStatus = userData.onlineStatus || {
      isOnline: false,
      lastActive: null,
    };
    return res.status(200).json({
      isOnline: onlineStatus.isOnline,
      lastActive: onlineStatus.lastActive,
    });
  } catch (error) {
    console.error("Error fetching user status:", {
      message: error.message,
      code: error.code,
      stack: error.stack,
    });
    return res.status(500).json({ error: "Failed to fetch user status" });
  }
};

// Update user status
const updateUserStatus = async (req, res) => {
  try {
    const { isOnline } = req.body;
    const userId = req.user.uid;
    const userRef = db.collection("users").doc(userId);
    await userRef.update({
      onlineStatus: {
        isOnline: isOnline || false,
        lastActive: new Date().toISOString(),
      },
    });
    return res.status(200).json({ message: "Status updated" });
  } catch (error) {
    console.error("Error updating user status:", {
      message: error.message,
      code: error.code,
      stack: error.stack,
    });
    return res.status(500).json({ error: "Failed to update status" });
  }
};

// Sync presence with Realtime Database and Firestore
const syncPresence = async (req, res) => {
  try {
    const { userId, isOnline } = req.body;
    const userRef = db.collection("users").doc(userId);
    await userRef.update({
      "onlineStatus.isOnline": isOnline,
      "onlineStatus.lastActive": new Date().toISOString(),
    });
    const presenceRef = database.ref(`presence/${userId}`);
    await presenceRef.set({
      isOnline,
      lastActive: new Date().toISOString(),
    });
    return res.status(200).json({ message: "Presence synced" });
  } catch (error) {
    console.error("Error syncing presence:", {
      message: error.message,
      code: error.code,
      stack: error.stack,
    });
    return res.status(500).json({ error: "Failed to sync presence" });
  }
};

module.exports = {
  getUserProfile,
  updateUserProfile,
  getUserClans,
  followUser,
  unfollowUser,
  getFriends,
  getUserById,
  getUserStatus,
  updateUserStatus,
  syncPresence,
};
