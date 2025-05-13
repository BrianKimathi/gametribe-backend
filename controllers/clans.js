const { db, storage } = require("../config/firebase");
const admin = require("firebase-admin");

// Fetch all clans
const getClans = async (req, res) => {
  try {
    console.log("Fetching clans with db:", db);
    const clansSnapshot = await db
      .collection("clans")
      .orderBy("createdAt", "desc")
      .get();
    const clans = clansSnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
      members: doc.data().members || [],
      points: doc.data().points || [],
    }));
    console.log("Fetched clans:", clans.length);
    res.status(200).json(clans);
  } catch (error) {
    console.error("Error fetching clans:", {
      message: error.message,
      code: error.code,
      stack: error.stack,
    });
    res
      .status(500)
      .json({ error: "Failed to fetch clans", details: error.message });
  }
};

// Create a new clan
const createClan = async (req, res) => {
  try {
    const { name, slogan } = req.body;
    if (!name || !slogan) {
      return res.status(400).json({ error: "Name and slogan are required" });
    }
    const userId = req.user.uid;
    const userRef = db.collection("users").doc(userId);
    const userDoc = await userRef.get();
    if (!userDoc.exists) {
      return res.status(404).json({ error: "User not found" });
    }
    const userData = userDoc.data();
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
    const newClan = {
      name,
      slogan,
      logo: logoUrl,
      adminId: userId,
      admin: userData.username || userData.email.split("@")[0],
      members: [{ userId, joinedAt: new Date().toISOString() }], // Use plain Date
      maxMembers: 5,
      isFull: false,
      points: [],
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    const docRef = await db.collection("clans").add(newClan);
    await userRef.update({
      clans: admin.firestore.FieldValue.arrayUnion(docRef.id),
    });
    res.status(201).json({ id: docRef.id, ...newClan });
  } catch (error) {
    console.error("Error creating clan:", {
      message: error.message,
      code: error.code,
      stack: error.stack,
    });
    res
      .status(500)
      .json({ error: "Failed to create clan", details: error.message });
  }
};

// Join a clan (direct join if <5 members)
const joinClan = async (req, res) => {
  try {
    const userId = req.user.uid;
    const clanId = req.params.id;
    const clanRef = db.collection("clans").doc(clanId);
    const clanDoc = await clanRef.get();
    if (!clanDoc.exists) {
      return res.status(404).json({ error: "Clan not found" });
    }
    const clanData = clanDoc.data();
    if (clanData.members.some((member) => member.userId === userId)) {
      return res.status(400).json({ error: "You are already a member" });
    }
    if (clanData.members.length >= clanData.maxMembers) {
      return res.status(400).json({ error: "Clan is full" });
    }
    await clanRef.update({
      members: admin.firestore.FieldValue.arrayUnion({
        userId,
        joinedAt: new Date().toISOString(), // Use plain Date
      }),
      isFull: clanData.members.length + 1 >= clanData.maxMembers,
    });
    const userRef = db.collection("users").doc(userId);
    await userRef.update({
      clans: admin.firestore.FieldValue.arrayUnion(clanId),
    });
    res.status(200).json({ message: "Joined clan successfully" });
  } catch (error) {
    console.error("Error joining clan:", {
      message: error.message,
      code: error.code,
      stack: error.stack,
    });
    res.status(500).json({ error: "Failed to join clan" });
  }
};

// Fetch clan members (for members only)
const getClanMembers = async (req, res) => {
  try {
    const userId = req.user.uid;
    const clanId = req.params.id;
    const clanRef = db.collection("clans").doc(clanId);
    const clanDoc = await clanRef.get();
    if (!clanDoc.exists) {
      return res.status(404).json({ error: "Clan not found" });
    }
    const clanData = clanDoc.data();
    if (!clanData.members.some((member) => member.userId === userId)) {
      return res
        .status(403)
        .json({ error: "You are not a member of this clan" });
    }
    const members = [];
    for (const member of clanData.members) {
      const userRef = db.collection("users").doc(member.userId);
      const userDoc = await userRef.get();
      if (userDoc.exists) {
        const userData = userDoc.data();
        members.push({
          id: member.userId,
          username: userData.username || userData.email.split("@")[0],
          avatar: userData.avatar || "",
          joinedAt: member.joinedAt,
        });
      }
    }
    res.status(200).json(members);
  } catch (error) {
    console.error("Error fetching clan members:", {
      message: error.message,
      code: error.code,
      stack: error.stack,
    });
    res.status(500).json({ error: "Failed to fetch clan members" });
  }
};

// Send a real-time group chat message
const sendGroupMessage = async (req, res) => {
  try {
    const clanId = req.params.id;
    const userId = req.user.uid;
    const { content } = req.body;
    const clanRef = db.collection("clans").doc(clanId);
    const clanDoc = await clanRef.get();
    if (!clanDoc.exists) {
      return res.status(404).json({ error: "Clan not found" });
    }
    const clan = clanDoc.data();
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
    const messagesRef = admin.database().ref(`clans/${clanId}/messages`);
    const newMessageRef = messagesRef.push();
    const userRef = db.collection("users").doc(userId);
    const userDoc = await userRef.get();
    const senderName = userDoc.exists
      ? userDoc.data().username || userDoc.data().email.split("@")[0]
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
    await db
      .collection("clans")
      .doc(clanId)
      .collection("messages")
      .doc(newMessageRef.key)
      .set(message);
    res.status(201).json(message);
  } catch (error) {
    console.error("Error sending group message:", {
      message: error.message,
      code: error.code,
      stack: error.stack,
    });
    res.status(500).json({ error: "Failed to send group message" });
  }
};

// Fetch real-time group chat messages
const getGroupMessages = async (req, res) => {
  try {
    const clanId = req.params.id;
    const userId = req.user.uid;
    const clanRef = db.collection("clans").doc(clanId);
    const clanDoc = await clanRef.get();
    if (!clanDoc.exists) {
      return res.status(404).json({ error: "Clan not found" });
    }
    const clan = clanDoc.data();
    if (!clan.members.some((member) => member.userId === userId)) {
      return res
        .status(403)
        .json({ error: "You are not a member of this clan" });
    }
    res.status(200).json({
      path: `clans/${clanId}/messages`,
      message: "Use Firebase Realtime Database to listen for messages",
    });
  } catch (error) {
    console.error("Error fetching group messages:", {
      message: error.message,
      code: error.code,
      stack: error.stack,
    });
    res.status(500).json({ error: "Failed to fetch group messages" });
  }
};

// Send a real-time direct message
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
    const messagesRef = admin
      .database()
      .ref(`directMessages/${chatId}/messages`);
    const newMessageRef = messagesRef.push();
    const userRef = db.collection("users").doc(senderId);
    const userDoc = await userRef.get();
    const senderName = userDoc.exists
      ? userDoc.data().username || userDoc.data().email.split("@")[0]
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
    await db
      .collection("directMessages")
      .doc(chatId)
      .set({ participants: [senderId, recipientId] }, { merge: true });
    await db
      .collection("directMessages")
      .doc(chatId)
      .collection("messages")
      .doc(newMessageRef.key)
      .set(message);
    res.status(201).json(message);
  } catch (error) {
    console.error("Error sending direct message:", {
      message: error.message,
      code: error.code,
      stack: error.stack,
    });
    res.status(500).json({ error: "Failed to send direct message" });
  }
};

// Fetch real-time direct messages
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
    res.status(200).json({
      path: `directMessages/${chatId}/messages`,
      message: "Use Firebase Realtime Database to listen for messages",
    });
  } catch (error) {
    console.error("Error fetching direct messages:", {
      message: error.message,
      code: error.code,
      stack: error.stack,
    });
    res.status(500).json({ error: "Failed to fetch direct messages" });
  }
};

// Add points to a clan (admin only)
const addClanPoints = async (req, res) => {
  try {
    const clanId = req.params.id;
    const { points } = req.body;
    if (!points || !Number.isInteger(points) || points <= 0) {
      return res.status(400).json({ error: "Valid points value is required" });
    }
    const clanRef = db.collection("clans").doc(clanId);
    const clanDoc = await clanRef.get();
    if (!clanDoc.exists) {
      return res.status(404).json({ error: "Clan not found" });
    }
    const clan = clanDoc.data();
    if (clan.adminId !== req.user.uid) {
      return res.status(403).json({ error: "Only the admin can add points" });
    }
    await clanRef.update({
      points: admin.firestore.FieldValue.arrayUnion(points),
    });
    res.status(200).json({ message: "Points added successfully" });
  } catch (error) {
    console.error("Error adding points:", {
      message: error.message,
      code: error.code,
      stack: error.stack,
    });
    res.status(500).json({ error: "Failed to add points" });
  }
};

// Update and sync online status
const updateOnlineStatus = async (req, res) => {
  try {
    const { isOnline } = req.body;
    const userId = req.user.uid;
    const presenceRef = admin.database().ref(`presence/${userId}`);
    const status = {
      isOnline: isOnline || false,
      lastActive: Date.now(),
    };
    await presenceRef.set(status);
    await db.collection("users").doc(userId).update({
      onlineStatus: status,
    });
    res.status(200).json({ message: "Online status updated" });
  } catch (error) {
    console.error("Error updating online status:", {
      message: error.message,
      code: error.code,
      stack: error.stack,
    });
    res.status(500).json({ error: "Failed to update online status" });
  }
};

// Get online status for a user
const getOnlineStatus = async (req, res) => {
  try {
    const { userId } = req.params;
    res.status(200).json({
      path: `presence/${userId}`,
      message: "Use Firebase Realtime Database to listen for online status",
    });
  } catch (error) {
    console.error("Error fetching online status:", {
      message: error.message,
      code: error.code,
      stack: error.stack,
    });
    res.status(500).json({ error: "Failed to fetch online status" });
  }
};

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
        avatar: "",
        createdAt: new Date().toISOString(),
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
    res.status(500).json({ error: "Failed to fetch user profile" });
  }
};

// Sync presence
const syncPresence = async (req, res) => {
  try {
    const { userId, isOnline } = req.body;
    const currentUserId = req.user.uid;
    if (userId !== currentUserId) {
      return res
        .status(403)
        .json({ error: "Unauthorized to sync presence for this user" });
    }
    const presenceRef = admin.database().ref(`presence/${userId}`);
    await presenceRef.set({
      isOnline,
      lastActive: Date.now(),
    });
    await db
      .collection("users")
      .doc(userId)
      .update({
        onlineStatus: {
          isOnline,
          lastActive: new Date().toISOString(),
        },
      });
    res.status(200).json({ message: "Presence synced" });
  } catch (error) {
    console.error("Error syncing presence:", {
      message: error.message,
      code: error.code,
      stack: error.stack,
    });
    res.status(500).json({ error: "Failed to sync presence" });
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
