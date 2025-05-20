const { database, storage } = require("../config/firebase");
const { v4: uuidv4 } = require("uuid");

const getClans = async (req, res) => {
  try {
    const clansRef = database.ref("clans");
    const snapshot = await clansRef.orderByChild("createdAt").once("value");
    const clansData = snapshot.val() || {};
    const clans = Object.entries(clansData).map(([id, data]) => ({
      id,
      ...data,
      members: data.members || [],
      points: data.points || [],
    }));
    clans.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return res.status(200).json(clans);
  } catch (error) {
    console.error("Error fetching clans:", error);
    return res.status(500).json({ error: "Failed to fetch clans" });
  }
};

const createClan = async (req, res) => {
  try {
    const { name, slogan } = req.body;
    if (!name || !slogan) {
      return res.status(400).json({ error: "Name and slogan are required" });
    }
    const userId = req.user.uid;
    const userRef = database.ref(`users/${userId}`);
    const userSnapshot = await userRef.once("value");
    if (!userSnapshot.exists()) {
      return res.status(404).json({ error: "User not found" });
    }
    const userData = userSnapshot.val();
    let logoUrl = "";
    if (req.file) {
      const file = req.file;
      const fileName = `clans/${Date.now()}-${file.originalname}`;
      const fileRef = storage.bucket().file(fileName);
      await fileRef.save(file.buffer, { contentType: file.mimetype });
      [logoUrl] = await fileRef.getSignedUrl({
        action: "read",
        expires: "03-09-2491",
      });
    }
    const clanId = uuidv4();
    const newClan = {
      name,
      slogan,
      logo: logoUrl,
      adminId: userId,
      admin: userData.username || userData.email.split("@")[0],
      members: [{ userId, joinedAt: new Date().toISOString() }],
      maxMembers: 5,
      isFull: false,
      points: [],
      createdAt: new Date().toISOString(),
    };
    await database.ref(`clans/${clanId}`).set(newClan);
    await userRef.update({
      clans: [...(userData.clans || []), clanId],
    });
    return res.status(201).json({ id: clanId, ...newClan });
  } catch (error) {
    console.error("Error creating clan:", error);
    return res.status(500).json({ error: "Failed to create clan" });
  }
};

const joinClan = async (req, res) => {
  try {
    const userId = req.user.uid;
    const clanId = req.params.id;
    const clanRef = database.ref(`clans/${clanId}`);
    const clanSnapshot = await clanRef.once("value");
    if (!clanSnapshot.exists()) {
      return res.status(404).json({ error: "Clan not found" });
    }
    const clanData = clanSnapshot.val();
    if (clanData.members.some((member) => member.userId === userId)) {
      return res.status(400).json({ error: "You are already a member" });
    }
    if (clanData.members.length >= clanData.maxMembers) {
      return res.status(400).json({ error: "Clan is full" });
    }
    const newMembers = [
      ...clanData.members,
      { userId, joinedAt: new Date().toISOString() },
    ];
    await clanRef.update({
      members: newMembers,
      isFull: newMembers.length >= clanData.maxMembers,
    });
    const userRef = database.ref(`users/${userId}`);
    const userSnapshot = await userRef.once("value");
    const userData = userSnapshot.val();
    await userRef.update({
      clans: [...(userData.clans || []), clanId],
    });
    return res.status(200).json({ message: "Joined clan successfully" });
  } catch (error) {
    console.error("Error joining clan:", error);
    return res.status(500).json({ error: "Failed to join clan" });
  }
};

const getClanMembers = async (req, res) => {
  try {
    const userId = req.user.uid;
    const clanId = req.params.id;
    const clanRef = database.ref(`clans/${clanId}`);
    const clanSnapshot = await clanRef.once("value");
    if (!clanSnapshot.exists()) {
      return res.status(404).json({ error: "Clan not found" });
    }
    const clanData = clanSnapshot.val();
    if (!clanData.members.some((member) => member.userId === userId)) {
      return res
        .status(403)
        .json({ error: "You are not a member of this clan" });
    }
    const members = [];
    for (const member of clanData.members) {
      const userRef = database.ref(`users/${member.userId}`);
      const userSnapshot = await userRef.once("value");
      if (userSnapshot.exists()) {
        const userData = userSnapshot.val();
        members.push({
          id: member.userId,
          username: userData.username || userData.email.split("@")[0],
          avatar: userData.avatar || "",
          joinedAt: member.joinedAt,
        });
      }
    }
    return res.status(200).json(members);
  } catch (error) {
    console.error("Error fetching clan members:", error);
    return res.status(500).json({ error: "Failed to fetch clan members" });
  }
};

const sendGroupMessage = async (req, res) => {
  try {
    const clanId = req.params.id;
    const userId = req.user.uid;
    const { content } = req.body;
    const clanRef = database.ref(`clans/${clanId}`);
    const clanSnapshot = await clanRef.once("value");
    if (!clanSnapshot.exists()) {
      return res.status(404).json({ error: "Clan not found" });
    }
    const clan = clanSnapshot.val();
    if (!clan.members.some((member) => member.userId === userId)) {
      return res
        .status(403)
        .json({ error: "You are not a member of this clan" });
    }
    if (!content && !req.file) {
      return res
        .status(400)
        .json({ error: "Content or attachment is required" });
    }
    let attachmentUrl = "";
    if (req.file) {
      const file = req.file;
      const fileName = `clans/${clanId}/messages/${Date.now()}-${
        file.originalname
      }`;
      const fileRef = storage.bucket().file(fileName);
      await fileRef.save(file.buffer, { contentType: file.mimetype });
      [attachmentUrl] = await fileRef.getSignedUrl({
        action: "read",
        expires: "03-09-2491",
      });
    }
    const messagesRef = database.ref(`clans/${clanId}/messages`);
    const newMessageRef = messagesRef.push();
    const userRef = database.ref(`users/${userId}`);
    const userSnapshot = await userRef.once("value");
    const senderName = userSnapshot.exists()
      ? userSnapshot.val().username || userSnapshot.val().email.split("@")[0]
      : "Unknown";
    const message = {
      id: newMessageRef.key,
      senderId: userId,
      sender: senderName,
      content: content || "",
      attachment: attachmentUrl,
      sentAt: Date.now(),
    };
    await newMessageRef.set(message);
    return res.status(201).json(message);
  } catch (error) {
    console.error("Error sending group message:", error);
    return res.status(500).json({ error: "Failed to send group message" });
  }
};

const getGroupMessages = async (req, res) => {
  try {
    const clanId = req.params.id;
    const userId = req.user.uid;
    const clanRef = database.ref(`clans/${clanId}`);
    const clanSnapshot = await clanRef.once("value");
    if (!clanSnapshot.exists()) {
      return res.status(404).json({ error: "Clan not found" });
    }
    const clan = clanSnapshot.val();
    if (!clan.members.some((member) => member.userId === userId)) {
      return res
        .status(403)
        .json({ error: "You are not a member of this clan" });
    }
    return res.status(200).json({
      path: `clans/${clanId}/messages`,
      message: "Use Firebase Realtime Database to listen for messages",
    });
  } catch (error) {
    console.error("Error fetching group messages:", error);
    return res.status(500).json({ error: "Failed to fetch group messages" });
  }
};

const sendDirectMessage = async (req, res) => {
  try {
    const { recipientId, content } = req.body;
    const senderId = req.user.uid;
    if (!recipientId || !content) {
      return res
        .status(400)
        .json({ error: "Recipient ID and content are required" });
    }
    let attachmentUrl = "";
    if (req.file) {
      const chatId = [senderId, recipientId].sort().join("_");
      const file = req.file;
      const fileName = `directMessages/${chatId}/${Date.now()}-${
        file.originalname
      }`;
      const fileRef = storage.bucket().file(fileName);
      await fileRef.save(file.buffer, { contentType: file.mimetype });
      [attachmentUrl] = await fileRef.getSignedUrl({
        action: "read",
        expires: "03-09-2491",
      });
    }
    const chatId = [senderId, recipientId].sort().join("_");
    const messagesRef = database.ref(`directMessages/${chatId}/messages`);
    const newMessageRef = messagesRef.push();
    const userRef = database.ref(`users/${senderId}`);
    const userSnapshot = await userRef.once("value");
    const senderName = userSnapshot.exists()
      ? userSnapshot.val().username || userSnapshot.val().email.split("@")[0]
      : "Unknown";
    const message = {
      id: newMessageRef.key,
      senderId,
      sender: senderName,
      content,
      attachment: attachmentUrl,
      sentAt: Date.now(),
    };
    await newMessageRef.set(message);
    return res.status(201).json(message);
  } catch (error) {
    console.error("Error sending direct message:", error);
    return res.status(500).json({ error: "Failed to send direct message" });
  }
};

const getDirectMessages = async (req, res) => {
  try {
    const { userId1, userId2 } = req.params;
    const requestingUserId = req.user.uid;
    if (requestingUserId !== userId1 && requestingUserId !== userId2) {
      return res
        .status(403)
        .json({ error: "You are not authorized to view these messages" });
    }
    const chatId = [userId1, userId2].sort().join("_");
    return res.status(200).json({
      path: `directMessages/${chatId}/messages`,
      message: "Use Firebase Realtime Database to listen for messages",
    });
  } catch (error) {
    console.error("Error fetching direct messages:", error);
    return res.status(500).json({ error: "Failed to fetch direct messages" });
  }
};

const addClanPoints = async (req, res) => {
  try {
    const clanId = req.params.id;
    const { points } = req.body;
    if (!points || !Number.isInteger(points) || points <= 0) {
      return res.status(400).json({ error: "Valid points value is required" });
    }
    const clanRef = database.ref(`clans/${clanId}`);
    const clanSnapshot = await clanRef.once("value");
    if (!clanSnapshot.exists()) {
      return res.status(404).json({ error: "Clan not found" });
    }
    const clan = clanSnapshot.val();
    if (clan.adminId !== req.user.uid) {
      return res.status(403).json({ error: "Only the admin can add points" });
    }
    await clanRef.update({
      points: [...(clan.points || []), points],
    });
    return res.status(200).json({ message: "Points added successfully" });
  } catch (error) {
    console.error("Error adding points:", error);
    return res.status(500).json({ error: "Failed to add points" });
  }
};

const updateOnlineStatus = async (req, res) => {
  try {
    const { isOnline } = req.body;
    const userId = req.user.uid;
    const presenceRef = database.ref(`presence/${userId}`);
    const status = {
      isOnline: isOnline || false,
      lastActive: Date.now(),
    };
    await presenceRef.set(status);
    await database.ref(`users/${userId}/onlineStatus`).set(status);
    return res.status(200).json({ message: "Online status updated" });
  } catch (error) {
    console.error("Error updating online status:", error);
    return res.status(500).json({ error: "Failed to update online status" });
  }
};

const getOnlineStatus = async (req, res) => {
  try {
    const { userId } = req.params;
    return res.status(200).json({
      path: `presence/${userId}`,
      message: "Use Firebase Realtime Database to listen for online status",
    });
  } catch (error) {
    console.error("Error fetching online status:", error);
    return res.status(500).json({ error: "Failed to fetch online status" });
  }
};

const getUserProfile = async (req, res) => {
  try {
    const userId = req.params.userId || req.user.uid;
    const userRef = database.ref(`users/${userId}`);
    const userSnapshot = await userRef.once("value");
    if (!userSnapshot.exists()) {
      const newUser = {
        uid: userId,
        email: req.user.email,
        username: req.user.email.split("@")[0],
        avatar: "",
        createdAt: new Date().toISOString(),
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
      lastActive: Date.now(),
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
  getClans,
  createClan,
  joinClan,
  getClanMembers,
  sendGroupMessage,
  getGroupMessages,
  sendDirectMessage,
  getDirectMessages,
  addClanPoints,
  updateOnlineStatus,
  getOnlineStatus,
  getUserProfile,
  syncPresence,
};
