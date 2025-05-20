const { database, storage } = require("../config/firebase");
const multer = require("multer");
const path = require("path");
const sanitizeHtml = require("sanitize-html");

// Configure multer for in-memory storage (used in routes/events.js)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
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

// Sanitize HTML input
const sanitizeDescription = (html) => {
  return sanitizeHtml(html, {
    allowedTags: ["p", "b", "i", "em", "strong", "a", "ul", "ol", "li", "br"],
    allowedAttributes: {
      a: ["href", "target"],
    },
  });
};

const createEvent = async (req, res, next) => {
  try {
    console.log("createEvent called with body:", req.body);
    console.log("File:", req.file);
    console.log("User:", req.user);

    const { title, description, startDate, endDate, imageUrl, category } =
      req.body;
    const userId = req.user.uid;

    if (!title || !description || !startDate) {
      return res
        .status(400)
        .json({ error: "Title, description, and start date are required" });
    }

    const eventData = {
      title,
      description: sanitizeDescription(description),
      startDate,
      endDate: endDate || null,
      image: imageUrl || null,
      category: category || null,
      authorId: userId,
      createdAt: new Date().toISOString(),
      bookings: {},
      comments: 0,
    };

    if (req.file) {
      console.log("Uploading image:", req.file);
      const fileName = `events/${Date.now()}_${req.file.originalname}`;
      const fileRef = storage.bucket().file(fileName);
      await fileRef.save(req.file.buffer, {
        metadata: { contentType: req.file.mimetype },
      });
      const [url] = await fileRef.getSignedUrl({
        action: "read",
        expires: "03-01-2500",
      });
      eventData.image = url;
    }

    const eventsRef = database.ref("events");
    const newEventRef = eventsRef.push();
    await newEventRef.set(eventData);

    res.status(201).json({ id: newEventRef.key, ...eventData });
  } catch (error) {
    console.error("Error in createEvent:", error);
    next(error);
  }
};

const getEvents = async (req, res) => {
  try {
    const snapshot = await database.ref("events").once("value");
    const events = snapshot.val() || {};
    const eventsArray = Object.entries(events).map(([id, event]) => ({
      id,
      ...event,
      bookingCount: event.bookings ? Object.keys(event.bookings).length : 0,
    }));
    res.status(200).json(eventsArray);
  } catch (error) {
    console.error("Error fetching events:", error);
    res.status(500).json({ error: "Failed to fetch events" });
  }
};

const getEventById = async (req, res) => {
  try {
    const { id } = req.params;
    const snapshot = await database.ref(`events/${id}`).once("value");
    const event = snapshot.val();
    if (!event) {
      return res.status(404).json({ error: "Event not found" });
    }
    res.status(200).json({
      id,
      ...event,
      bookingCount: event.bookings ? Object.keys(event.bookings).length : 0,
    });
  } catch (error) {
    console.error("Error fetching event:", error);
    res.status(500).json({ error: "Failed to fetch event" });
  }
};

const updateEvent = async (req, res, next) => {
  try {
    console.log("updateEvent called with body:", req.body);
    console.log("File:", req.file);
    console.log("User:", req.user);
    const { id } = req.params;
    const { title, description, startDate, endDate, imageUrl, category } =
      req.body;
    const userId = req.user.uid;

    const eventRef = database.ref(`events/${id}`);
    const snapshot = await eventRef.once("value");
    const event = snapshot.val();

    if (!event) {
      return res.status(404).json({ error: "Event not found" });
    }
    if (event.authorId !== userId) {
      return res
        .status(403)
        .json({ error: "Unauthorized: Only the author can update this event" });
    }

    // Validate and format dates
    let start, end;
    if (startDate) {
      start = new Date(startDate);
      if (isNaN(start.getTime())) {
        return res.status(400).json({ error: "Invalid start date" });
      }
    }
    if (endDate) {
      end = new Date(endDate);
      if (isNaN(end.getTime())) {
        return res.status(400).json({ error: "Invalid end date" });
      }
      if (startDate && end < new Date(startDate)) {
        return res
          .status(400)
          .json({ error: "End date must be after start date" });
      }
    }

    let image = event.image;
    if (req.file) {
      const fileName = `events/${Date.now()}_${req.file.originalname}`;
      const fileRef = storage.bucket().file(fileName);
      await fileRef.save(req.file.buffer, {
        metadata: { contentType: req.file.mimetype },
      });
      const [url] = await fileRef.getSignedUrl({
        action: "read",
        expires: "03-01-2500",
      });
      image = url;
    } else if (imageUrl) {
      image = imageUrl;
    } else if (imageUrl === "") {
      image = null;
    }

    const updates = {};
    if (title) updates.title = title;
    if (description) updates.description = sanitizeDescription(description);
    if (startDate) updates.startDate = start.toISOString();
    if (endDate !== undefined) updates.endDate = end ? end.toISOString() : null;
    if (image !== undefined) updates.image = image;
    if (category !== undefined) updates.category = category;

    await eventRef.set({ ...event, ...updates });
    res.status(200).json({ id, ...event, ...updates });
  } catch (error) {
    console.error("Error updating event:", error);
    next(error);
  }
};

const deleteEvent = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.uid;

    const eventRef = database.ref(`events/${id}`);
    const snapshot = await eventRef.once("value");
    const event = snapshot.val();

    if (!event) {
      return res.status(404).json({ error: "Event not found" });
    }
    if (event.authorId !== userId) {
      return res
        .status(403)
        .json({ error: "Unauthorized: Only the author can delete this event" });
    }

    // Optionally delete image from Storage if it exists
    if (event.image) {
      try {
        const filePath = event.image.match(/events%2F([^?]+)/)?.[1];
        if (filePath) {
          await storage
            .bucket()
            .file(`events/${decodeURIComponent(filePath)}`)
            .delete();
        }
      } catch (error) {
        console.warn("Error deleting image:", error);
      }
    }

    await eventRef.remove();
    res.status(200).json({ message: "Event deleted successfully" });
  } catch (error) {
    console.error("Error deleting event:", error);
    next(error);
  }
};

const bookEvent = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.uid;

    const eventRef = database.ref(`events/${id}`);
    const snapshot = await eventRef.once("value");
    const event = snapshot.val();

    if (!event) {
      return res.status(404).json({ error: "Event not found" });
    }

    const bookingRef = database.ref(`events/${id}/bookings/${userId}`);
    const bookingSnapshot = await bookingRef.once("value");
    if (bookingSnapshot.exists()) {
      return res
        .status(400)
        .json({ error: "You have already booked this event" });
    }

    await bookingRef.set({
      bookedAt: new Date().toISOString(),
      userId,
    });

    res.status(200).json({ message: "Event booked successfully" });
  } catch (error) {
    console.error("Error booking event:", error);
    next(error);
  }
};

const cancelBooking = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.uid;

    const bookingRef = database.ref(`events/${id}/bookings/${userId}`);
    const snapshot = await bookingRef.once("value");

    if (!snapshot.exists()) {
      return res.status(404).json({ error: "Booking not found" });
    }

    await bookingRef.remove();
    res.status(200).json({ message: "Booking cancelled successfully" });
  } catch (error) {
    console.error("Error cancelling booking:", error);
    next(error);
  }
};

const getEventBookings = async (req, res, next) => {
  try {
    const { id } = req.params;
    const snapshot = await database.ref(`events/${id}/bookings`).once("value");
    const bookings = snapshot.val() || {};

    const bookingsWithUsers = await Promise.all(
      Object.entries(bookings).map(async ([userId, booking]) => {
        const userSnapshot = await database
          .ref(`users/${userId}`)
          .once("value");
        const user = userSnapshot.val() || {};
        return {
          userId,
          bookedAt: booking.bookedAt,
          userName:
            user.displayName || user.email?.split("@")[0] || "Anonymous",
          userAvatar: user.avatar || "https://via.placeholder.com/40",
        };
      })
    );

    res.status(200).json(bookingsWithUsers);
  } catch (error) {
    console.error("Error fetching bookings:", error);
    next(error);
  }
};

// Export controllers without multer for updateEvent
module.exports = {
  createEvent,
  getEvents,
  getEventById,
  updateEvent, // Multer moved to routes/events.js
  deleteEvent,
  bookEvent,
  cancelBooking,
  getEventBookings,
};
