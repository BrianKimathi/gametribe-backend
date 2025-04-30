const { db, storage, admin } = require("../config/firebase");
const multer = require("multer");

const upload = multer({ storage: multer.memoryStorage() });

// Fetch all clans
const getClans = async (req, res) => {
  try {
    const snapshot = await db.collection("clans").get();
    const clans = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));
    res.status(200).json(clans);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch clans" });
  }
};

// Create a new clan
const createClan = async (req, res) => {
  const { name, slogan } = req.body;
  if (!name || !slogan) {
    return res.status(400).json({ error: "Name and slogan are required" });
  }

  try {
    const newClan = {
      name,
      slogan,
      logo: "",
      adminId: req.user.uid,
      members: [
        {
          userId: req.user.uid,
          joinedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
      ],
      maxMembers: 60,
      isFull: false,
      points: [], // Initialize empty points array
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    const docRef = await db.collection("clans").add(newClan);

    // Update user's clans array
    await db
      .collection("users")
      .doc(req.user.uid)
      .update({
        clans: admin.firestore.FieldValue.arrayUnion(docRef.id),
      });

    // Handle logo upload if provided
    let logoUrl = "";
    if (req.file) {
      const file = req.file;
      const fileName = `clans/${docRef.id}/logo-${Date.now()}-${
        file.originalname
      }`;
      const fileRef = storage.bucket().file(fileName);
      await fileRef.save(file.buffer, { contentType: file.mimetype });
      [logoUrl] = await fileRef.getSignedUrl({
        action: "read",
        expires: "03-09-2491",
      });
      await docRef.update({ logo: logoUrl });
    }

    res.status(201).json({ id: docRef.id, ...newClan, logo: logoUrl });
  } catch (error) {
    console.error("Error creating clan:", error);
    res.status(500).json({ error: "Failed to create clan" });
  }
};

// Send a join request
const sendJoinRequest = async (req, res) => {
  const clanId = req.params.id;
  const userId = req.user.uid;

  try {
    const clanRef = db.collection("clans").doc(clanId);
    const clanDoc = await clanRef.get();

    if (!clanDoc.exists) {
      return res.status(404).json({ error: "Clan not found" });
    }

    const clan = clanDoc.data();
    if (clan.isFull) {
      return res.status(400).json({ error: "Clan is full" });
    }

    if (clan.members.some((member) => member.userId === userId)) {
      return res
        .status(400)
        .json({ error: "You are already a member of this clan" });
    }

    const requestRef = clanRef.collection("joinRequests").doc(userId);
    const requestDoc = await requestRef.get();
    if (requestDoc.exists && requestDoc.data().status === "pending") {
      return res.status(400).json({ error: "Join request already pending" });
    }

    await requestRef.set({
      userId,
      status: "pending",
      requestedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.status(200).json({ message: "Join request sent" });
  } catch (error) {
    console.error("Error sending join request:", error);
    res.status(500).json({ error: "Failed to send join request" });
  }
};

// Approve or reject a join request (admin only)
const handleJoinRequest = async (req, res) => {
  const clanId = req.params.clanId;
  const userId = req.params.userId;
  const { action } = req.body;

  if (!["approve", "reject"].includes(action)) {
    return res.status(400).json({ error: "Invalid action" });
  }

  try {
    const clanRef = db.collection("clans").doc(clanId);
    const clanDoc = await clanRef.get();

    if (!clanDoc.exists) {
      return res.status(404).json({ error: "Clan not found" });
    }

    const clan = clanDoc.data();
    if (clan.adminId !== req.user.uid) {
      return res
        .status(403)
        .json({ error: "Only the admin can handle join requests" });
    }

    const requestRef = clanRef.collection("joinRequests").doc(userId);
    const requestDoc = await requestRef.get();

    if (!requestDoc.exists) {
      return res.status(404).json({ error: "Join request not found" });
    }

    if (action === "approve") {
      if (clan.isFull) {
        return res.status(400).json({ error: "Clan is full" });
      }

      await clanRef.update({
        members: admin.firestore.FieldValue.arrayUnion({
          userId,
          joinedAt: admin.firestore.FieldValue.serverTimestamp(),
        }),
      });

      await db
        .collection("users")
        .doc(userId)
        .update({
          clans: admin.firestore.FieldValue.arrayUnion(clanId),
        });

      // Check if clan is now full
      const updatedClanDoc = await clanRef.get();
      const updatedClan = updatedClanDoc.data();
      if (updatedClan.members.length >= updatedClan.maxMembers) {
        await clanRef.update({ isFull: true });
      }
    }

    await requestRef.update({ status: action });

    res.status(200).json({ message: `Join request ${action}d` });
  } catch (error) {
    console.error("Error handling join request:", error);
    res.status(500).json({ error: "Failed to handle join request" });
  }
};

// Fetch join requests for a clan (admin only)
const getJoinRequests = async (req, res) => {
  const clanId = req.params.id;

  try {
    const clanRef = db.collection("clans").doc(clanId);
    const clanDoc = await clanRef.get();

    if (!clanDoc.exists) {
      return res.status(404).json({ error: "Clan not found" });
    }

    const clan = clanDoc.data();
    if (clan.adminId !== req.user.uid) {
      return res
        .status(403)
        .json({ error: "Only the admin can view join requests" });
    }

    const snapshot = await clanRef
      .collection("joinRequests")
      .where("status", "==", "pending")
      .get();
    const requests = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    res.status(200).json(requests);
  } catch (error) {
    console.error("Error fetching join requests:", error);
    res.status(500).json({ error: "Failed to fetch join requests" });
  }
};

// Send a message to the group chat
const sendGroupMessage = async (req, res) => {
  const clanId = req.params.id;
  const userId = req.user.uid;

  try {
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

    let content = req.body.content || "";
    let attachmentUrl = "";

    if (!content && !req.file) {
      return res
        .status(400)
        .json({ error: "Content or attachment is required" });
    }

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

    const message = {
      senderId: userId,
      content,
      attachment: attachmentUrl,
      sentAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    const docRef = await clanRef.collection("messages").add(message);
    res.status(201).json({ id: docRef.id, ...message });
  } catch (error) {
    console.error("Error sending message:", error);
    res.status(500).json({ error: "Failed to send message" });
  }
};

// Fetch group chat messages
const getGroupMessages = async (req, res) => {
  const clanId = req.params.id;
  const userId = req.user.uid;

  try {
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

    const snapshot = await clanRef
      .collection("messages")
      .orderBy("sentAt", "desc")
      .limit(50)
      .get();
    const messages = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    res.status(200).json(messages);
  } catch (error) {
    console.error("Error fetching messages:", error);
    res.status(500).json({ error: "Failed to fetch messages" });
  }
};

// Fetch direct messages between two users
const getDirectMessages = async (req, res) => {
  const { userId1, userId2 } = req.params;

  try {
    const chatId = [userId1, userId2].sort().join("_");
    const chatRef = db.collection("directMessages").doc(chatId);
    const chatDoc = await chatRef.get();

    if (!chatDoc.exists) {
      return res.status(200).json([]);
    }

    const snapshot = await chatRef
      .collection("messages")
      .orderBy("sentAt", "desc")
      .limit(50)
      .get();
    const messages = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    res.status(200).json(messages);
  } catch (error) {
    console.error("Error fetching direct messages:", error);
    res.status(500).json({ error: "Failed to fetch direct messages" });
  }
};

// Send a direct message
const sendDirectMessage = async (req, res) => {
  const { recipientId, content } = req.body;
  const senderId = req.user.uid;

  if (!recipientId || !content) {
    return res
      .status(400)
      .json({ error: "Recipient ID and content are required" });
  }

  try {
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
    const chatRef = db.collection("directMessages").doc(chatId);

    const message = {
      senderId,
      content,
      attachment: attachmentUrl,
      sentAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    await chatRef.set(
      { participants: [senderId, recipientId] },
      { merge: true }
    );
    const docRef = await chatRef.collection("messages").add(message);

    res.status(201).json({ id: docRef.id, ...message });
  } catch (error) {
    console.error("Error sending direct message:", error);
    res.status(500).json({ error: "Failed to send direct message" });
  }
};

// Add points to a clan (admin only)
const addClanPoints = async (req, res) => {
  const clanId = req.params.id;
  const { points } = req.body;

  if (!points || !Number.isInteger(points) || points <= 0) {
    return res.status(400).json({ error: "Valid points value is required" });
  }

  try {
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
    console.error("Error adding points:", error);
    res.status(500).json({ error: "Failed to add points" });
  }
};

module.exports = {
  getClans,
  createClan: [upload.single("logo"), createClan],
  sendJoinRequest,
  handleJoinRequest,
  getJoinRequests,
  sendGroupMessage: [upload.single("attachment"), sendGroupMessage],
  getGroupMessages,
  getDirectMessages,
  sendDirectMessage: [upload.single("attachment"), sendDirectMessage],
  addClanPoints,
};
