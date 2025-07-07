const express = require("express");
const router = express.Router();
const multer = require("multer");
const {
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
  createAnnouncement,
  getAnnouncements,
} = require("../controllers/clans");
const authenticate = require("../middleware/auth");

const upload = multer({ storage: multer.memoryStorage() });

// Debug logs to inspect imports
console.log("Imported controllers:", {
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
  createAnnouncement,
  getAnnouncements,
});
console.log("Imported authenticate:", authenticate);

// Fetch all clans
router.get("/", getClans);

// Create a new clan
router.post("/", authenticate, upload.single("logo"), createClan);

// Join a clan (direct join for clans with <5 members)
router.post("/:id/join", authenticate, joinClan);

// Fetch clan members (for members only)
router.get("/:id/members", authenticate, getClanMembers);

// Send a group chat message
router.post(
  "/:id/messages",
  authenticate,
  upload.single("attachment"),
  sendGroupMessage
);

// Fetch group chat messages
router.get("/:id/messages", authenticate, getGroupMessages);

// Fetch direct messages between two users
router.get(
  "/direct-messages/:userId1/:userId2",
  authenticate,
  getDirectMessages
);

// Send a direct message
router.post(
  "/direct-messages",
  authenticate,
  upload.single("attachment"),
  sendDirectMessage
);

// Add points to a clan
router.post("/:id/points", authenticate, addClanPoints);

// Update online status
router.post("/online-status", authenticate, updateOnlineStatus);

// Get online status
router.get("/online-status/:userId", authenticate, getOnlineStatus);

// Sync presence
router.post("/sync-presence", authenticate, syncPresence);

// Get user profile
router.get("/users/:userId", authenticate, getUserProfile);

// Direct Message Routes
router.post(
  "/messages/direct",
  authenticate,
  upload.single("attachment"),
  sendDirectMessage
);
router.get(
  "/messages/direct/:userId1/:userId2",
  authenticate,
  getDirectMessages
);

// Create an announcement
router.post(
  "/:id/announcements",
  authenticate,
  upload.single("attachment"),
  (req, res, next) => {
    console.log(`Handling POST /api/clans/${req.params.id}/announcements`);
    console.log("Authenticated user:", req.user);
    console.log("Request body:", req.body);
    console.log("Request file:", req.file);
    next();
  },
  createAnnouncement
);

// Fetch announcements
router.get(
  "/:id/announcements",
  authenticate,
  (req, res, next) => {
    console.log(`Handling GET /api/clans/${req.params.id}/announcements`);
    console.log("Authenticated user:", req.user);
    next();
  },
  getAnnouncements
);

// Error Handling
router.use((err, req, res, next) => {
  console.error("Server error in clans router:", err);
  res.status(500).json({ error: "Internal server error" });
});

module.exports = router;