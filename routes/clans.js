const express = require("express");
const router = express.Router();
const {
  getClans,
  createClan,
  sendJoinRequest,
  handleJoinRequest,
  getJoinRequests,
  sendGroupMessage,
  getGroupMessages,
  getDirectMessages,
  sendDirectMessage,
  addClanPoints,
} = require("../controllers/clans");
const authenticate = require("../middleware/auth");

// Fetch all clans
router.get("/", getClans);

// Create a new clan
router.post("/", authenticate, createClan);

// Send a join request
router.post("/:id/join", authenticate, sendJoinRequest);

// Approve or reject a join request
router.post("/:clanId/join/:userId", authenticate, handleJoinRequest);

// Fetch join requests for a clan
router.get("/:id/join-requests", authenticate, getJoinRequests);

// Send a group chat message
router.post("/:id/messages", authenticate, sendGroupMessage);

// Fetch group chat messages
router.get("/:id/messages", authenticate, getGroupMessages);

// Fetch direct messages between two users
router.get(
  "/direct-messages/:userId1/:userId2",
  authenticate,
  getDirectMessages
);

// Send a direct message
router.post("/direct-messages", authenticate, sendDirectMessage);

// Add points to a clan
router.post("/:id/points", authenticate, addClanPoints);

module.exports = router;
