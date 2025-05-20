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
} = require("../controllers/events");
const authenticate = require("../middleware/auth");
const multer = require("multer");

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

// Protected routes
router.post("/", authenticate, upload.single("image"), createEvent);
router.put("/:id", authenticate, upload.single("image"), updateEvent); // Added multer
router.delete("/:id", authenticate, deleteEvent);
router.post("/:id/book", authenticate, bookEvent);
router.delete("/:id/book", authenticate, cancelBooking);

module.exports = router;
