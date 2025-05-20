const { database } = require("../config/firebase");

const getUserProfile = async (req, res) => {
  try {
    const userId = req.user.uid;
    const userRef = database.ref(`users/${userId}`);
    const userSnapshot = await userRef.once("value");
    if (!userSnapshot.exists()) {
      const newUser = {
        uid: userId,
        email: req.user.email,
        username: req.user.email.split("@")[0],
        avatar: req.user.picture || "",
        createdAt: new Date().toISOString(),
        friendsCount: 0,
        friends: [],
        clans: [],
      };
      await userRef.set(newUser);
      return res.status(200).json(newUser);
    }
    return res.status(200).json(userSnapshot.val());
  } catch (error) {
    console.error("Error fetching user profile:", error);
    return res.status(500).json({ error: "Failed to fetch user profile" });
  }
};

const updateUserProfile = async (req, res) => {
  try {
    const userId = req.user.uid;
    const { username, avatar } = req.body;
    if (!username && !avatar) {
      return res
        .status(400)
        .json({ error: "At least one field (username or avatar) is required" });
    }
    const userRef = database.ref(`users/${userId}`);
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

const getUserClans = async (req, res) => {
  try {
    const userId = req.user.uid;
    const userRef = database.ref(`users/${userId}`);
    const userSnapshot = await userRef.once("value");
    if (!userSnapshot.exists()) {
      return res.status(404).json({ error: "User not found" });
    }
    const clanIds = userSnapshot.val().clans || [];
    const clans = [];
    for (const clanId of clanIds) {
      const clanRef = database.ref(`clans/${clanId}`);
      const clanSnapshot = await clanRef.once("value");
      if (clanSnapshot.exists()) {
        clans.push({ id: clanId, ...clanSnapshot.val() });
      }
    }
    return res.status(200).json(clans);
  } catch (error) {
    console.error("Error fetching user clans:", error);
    return res.status(500).json({ error: "Failed to fetch user clans" });
  }
};

const followUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const currentUserId = req.user.uid;
    if (currentUserId === userId) {
      return res.status(400).json({ error: "Cannot follow yourself" });
    }
    const userRef = database.ref(`users/${userId}`);
    const userSnapshot = await userRef.once("value");
    if (!userSnapshot.exists()) {
      return res.status(404).json({ error: "User not found" });
    }
    const userData = userSnapshot.val();
    const currentUserRef = database.ref(`users/${currentUserId}`);
    const currentUserSnapshot = await currentUserRef.once("value");
    const currentUserData = currentUserSnapshot.val();
    if (
      (currentUserData.friends || []).some((friend) => friend.uid === userId)
    ) {
      return res.status(400).json({ error: "Already following this user" });
    }
    const newFriend = {
      uid: userId,
      username: userData.username || userData.email.split("@")[0],
      avatar: userData.avatar || "",
      followedAt: new Date().toISOString(),
    };
    await currentUserRef.update({
      friends: [...(currentUserData.friends || []), newFriend],
      friendsCount: (currentUserData.friendsCount || 0) + 1,
    });
    await userRef.update({
      friendsCount: (userData.friendsCount || 0) + 1,
    });
    return res.status(200).json({ message: "User followed successfully" });
  } catch (error) {
    console.error("Error following user:", error);
    return res.status(500).json({ error: "Failed to follow user" });
  }
};

const unfollowUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const currentUserId = req.user.uid;
    if (currentUserId === userId) {
      return res.status(400).json({ error: "Cannot unfollow yourself" });
    }
    const currentUserRef = database.ref(`users/${currentUserId}`);
    const currentUserSnapshot = await currentUserRef.once("value");
    if (!currentUserSnapshot.exists()) {
      return res.status(404).json({ error: "User not found" });
    }
    const currentUserData = currentUserSnapshot.val();
    if (
      !(currentUserData.friends || []).some((friend) => friend.uid === userId)
    ) {
      return res.status(400).json({ error: "Not following this user" });
    }
    await currentUserRef.update({
      friends: (currentUserData.friends || []).filter(
        (friend) => friend.uid !== userId
      ),
      friendsCount: (currentUserData.friendsCount || 1) - 1,
    });
    const userRef = database.ref(`users/${userId}`);
    const userSnapshot = await userRef.once("value");
    if (userSnapshot.exists()) {
      const userData = userSnapshot.val();
      await userRef.update({
        friendsCount: (userData.friendsCount || 1) - 1,
      });
    }
    return res.status(200).json({ message: "User unfollowed successfully" });
  } catch (error) {
    console.error("Error unfollowing user:", error);
    return res.status(500).json({ error: "Failed to unfollow user" });
  }
};

const getFriends = async (req, res) => {
  try {
    const userId = req.params.userId;
    const userRef = database.ref(`users/${userId}`);
    const userSnapshot = await userRef.once("value");
    if (!userSnapshot.exists()) {
      return res.status(404).json({ error: "User not found" });
    }
    const friends = userSnapshot.val().friends || [];
    return res.status(200).json(friends);
  } catch (error) {
    console.error("Error fetching friends:", error);
    return res.status(500).json({ error: "Failed to fetch friends" });
  }
};

const getUserById = async (req, res) => {
  try {
    const { userId } = req.params;
    const userRef = database.ref(`users/${userId}`);
    const userSnapshot = await userRef.once("value");
    if (!userSnapshot.exists()) {
      return res.status(404).json({ error: "User not found" });
    }
    const userData = userSnapshot.val();
    return res.status(200).json({
      uid: userId,
      username: userData.username || userData.email.split("@")[0],
      avatar: userData.avatar || "",
    });
  } catch (error) {
    console.error("Error fetching user:", error);
    return res.status(500).json({ error: "Failed to fetch user" });
  }
};

const getUserStatus = async (req, res) => {
  try {
    const userId = req.params.userId;
    const userRef = database.ref(`users/${userId}`);
    const userSnapshot = await userRef.once("value");
    if (!userSnapshot.exists()) {
      return res.status(404).json({ error: "User not found" });
    }
    const userData = userSnapshot.val();
    const onlineStatus = userData.onlineStatus || {
      isOnline: false,
      lastActive: null,
    };
    return res.status(200).json({
      isOnline: onlineStatus.isOnline,
      lastActive: onlineStatus.lastActive,
    });
  } catch (error) {
    console.error("Error fetching user status:", error);
    return res.status(500).json({ error: "Failed to fetch user status" });
  }
};

const updateUserStatus = async (req, res) => {
  try {
    const { isOnline } = req.body;
    const userId = req.user.uid;
    const userRef = database.ref(`users/${userId}`);
    await userRef.update({
      onlineStatus: {
        isOnline: isOnline || false,
        lastActive: new Date().toISOString(),
      },
    });
    return res.status(200).json({ message: "Status updated" });
  } catch (error) {
    console.error("Error updating user status:", error);
    return res.status(500).json({ error: "Failed to update status" });
  }
};

const syncPresence = async (req, res) => {
  try {
    const { userId, isOnline } = req.body;
    const currentUserId = req.user.uid;
    if (userId !== currentUserId) {
      return res
        .status(403)
        .json({ error: "Unauthorized to sync presence for this user" });
    }
    const presenceRef = database.ref(`presence/${userId}`);
    await presenceRef.set({
      isOnline,
      lastActive: new Date().toISOString(),
    });
    await database.ref(`users/${userId}/onlineStatus`).set({
      isOnline,
      lastActive: new Date().toISOString(),
    });
    return res.status(200).json({ message: "Presence synced" });
  } catch (error) {
    console.error("Error syncing presence:", error);
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
