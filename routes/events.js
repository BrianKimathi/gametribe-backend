const express = require("express");
const router = express.Router();
const {
  createEvent,
  getEvents,
  getEventById,
  updateEvent,
  deleteEvent,
  bookEvent,
  cancelBooking,
  getEventBookings,
  getEventComments,
  createEventComment,
  createEventReply,
  likeEventComment,
  likeEventReply,
} = require("../controllers/events");
const authenticate = require("../middleware/auth");
const multer = require("multer");
const path = require("path");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
    fieldSize: 10 * 1024 * 1024, // 10MB for fields
    parts: 10, // Max 10 parts
  },
  fileFilter: (req, file, cb) => {
    const filetypes = /jpeg|jpg|png/;
    const extname = filetypes.test(
      path.extname(file.originalname).toLowerCase()
    );
    const mimetype = filetypes.test(file.mimetype);
    if (extname && mimetype) {
      return cb(null, true);
    }
    cb(new Error("Only JPEG/PNG images are allowed"));
  },
});

// Public routes
router.get("/", getEvents);
router.get("/:id", getEventById);
router.get("/:id/bookings", getEventBookings);
router.get("/:id/comments", getEventComments);

// Protected routes
router.post("/", authenticate, upload.single("image"), createEvent);
router.put("/:id", authenticate, upload.single("image"), updateEvent);
router.delete("/:id", authenticate, deleteEvent);
router.post("/:id/book", authenticate, bookEvent);
router.delete("/:id/book", authenticate, cancelBooking);
router.post(
  "/:id/comments",
  authenticate,
  upload.single("attachment"),
  createEventComment
);
router.post(
  "/:id/comments/:commentId/replies",
  authenticate,
  upload.single("attachment"),
  createEventReply
);
router.put("/:id/comments/:commentId/like", authenticate, likeEventComment);
router.put(
  "/:id/comments/:commentId/replies/:replyId/like",
  authenticate,
  likeEventReply
);

module.exports = router;
