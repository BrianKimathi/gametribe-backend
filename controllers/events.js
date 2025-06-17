const { database, storage } = require("../config/firebase");
const { v4: uuidv4 } = require("uuid");
const sanitizeHtml = require("sanitize-html");

// Sanitize HTML input
const sanitizeInput = (html) => {
  return sanitizeHtml(html, {
    allowedTags: ["p", "b", "i", "em", "strong", "a", "ul", "ol", "li", "br"],
    allowedAttributes: {
      a: ["href", "target"],
    },
  });
};

const createEvent = async (req, res, next) => {
  try {
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
      description: sanitizeInput(description),
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
    console.error("Error in createEvent:", error.message, error.stack);
    next(error);
  }
};

const getEvents = async (req, res, next) => {
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
    console.error("Error fetching events:", error.message, error.stack);
    res.status(500).json({ error: "Failed to fetch events" });
  }
};

const getEventById = async (req, res, next) => {
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
    console.error("Error fetching event:", error.message, error.stack);
    res.status(500).json({ error: "Failed to fetch event" });
  }
};

const updateEvent = async (req, res, next) => {
  try {
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
    if (description) updates.description = sanitizeInput(description);
    if (startDate) updates.startDate = start.toISOString();
    if (endDate !== undefined) updates.endDate = end ? end.toISOString() : null;
    if (image !== undefined) updates.image = image;
    if (category !== undefined) updates.category = category;

    await eventRef.set({ ...event, ...updates });
    res.status(200).json({ id, ...event, ...updates });
  } catch (error) {
    console.error("Error updating event:", error.message, error.stack);
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
        console.warn("Error deleting image:", error.message);
      }
    }

    await eventRef.remove();
    res.status(200).json({ message: "Event deleted successfully" });
  } catch (error) {
    console.error("Error deleting event:", error.message, error.stack);
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
    console.error("Error booking event:", error.message, error.stack);
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
    console.error("Error cancelling booking:", error.message, error.stack);
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
    console.error("Error fetching bookings:", error.message, error.stack);
    next(error);
  }
};

const getEventComments = async (req, res, next) => {
  try {
    const { eventId } = req.params;
    if (!eventId) {
      return res.status(400).json({ error: "Event ID is required" });
    }
    const eventRef = database.ref(`events/${eventId}`);
    const eventSnapshot = await eventRef.once("value");
    if (!eventSnapshot.exists()) {
      return res.status(404).json({ error: "Event not found" });
    }
    const commentsRef = database.ref(`events/${eventId}/comments`);
    const commentsSnapshot = await commentsRef
      .orderByChild("createdAt")
      .once("value");
    const commentsData = commentsSnapshot.val() || {};
    const comments = [];
    for (const [commentId, commentData] of Object.entries(commentsData)) {
      const repliesRef = database.ref(
        `events/${eventId}/comments/${commentId}/replies`
      );
      const repliesSnapshot = await repliesRef
        .orderByChild("createdAt")
        .once("value");
      const repliesData = repliesSnapshot.val() || {};
      commentData.id = commentId;
      commentData.likes = commentData.likes || 0;
      commentData.likedBy = Array.isArray(commentData.likedBy)
        ? commentData.likedBy
        : [];
      commentData.replies = Object.entries(repliesData).map(
        ([replyId, replyData]) => ({
          id: replyId,
          ...replyData,
          likes: replyData.likes || 0,
          likedBy: Array.isArray(replyData.likedBy) ? replyData.likedBy : [],
        })
      );
      comments.push(commentData);
    }
    comments.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.status(200).json(comments);
  } catch (error) {
    console.error("Error fetching event comments:", error.message, error.stack);
    res.status(500).json({ error: "Failed to fetch comments" });
  }
};

const createEventComment = async (req, res, next) => {
  try {
    const { eventId } = req.params;
    const userId = req.user.uid;
    if (!eventId) {
      return res.status(400).json({ error: "Event ID is required" });
    }
    if (!req.body.content && !req.file) {
      return res
        .status(400)
        .json({ error: "Comment content or attachment is required" });
    }
    const sanitizedContent = sanitizeInput(req.body.content) || "";
    const eventRef = database.ref(`events/${eventId}`);
    const eventSnapshot = await eventRef.once("value");
    if (!eventSnapshot.exists()) {
      return res.status(404).json({ error: "Event not found" });
    }
    const userRef = database.ref(`users/${userId}`);
    const userSnapshot = await userRef.once("value");
    if (!userSnapshot.exists()) {
      return res.status(404).json({ error: "User not found" });
    }
    const userData = userSnapshot.val();
    let attachmentUrl = "";
    if (req.file) {
      const file = req.file;
      if (!file.mimetype.startsWith("image/")) {
        return res.status(400).json({ error: "Only image files are allowed" });
      }
      const fileName = `events/${eventId}/comments/${Date.now()}-${
        file.originalname
      }`;
      const fileRef = storage.bucket().file(fileName);
      await fileRef.save(file.buffer, { contentType: file.mimetype });
      [attachmentUrl] = await fileRef.getSignedUrl({
        action: "read",
        expires: "03-01-2500",
      });
    }
    const commentId = uuidv4();
    const comment = {
      id: commentId,
      eventId,
      authorId: userId,
      author: userData.username || userData.email.split("@")[0],
      authorImage: userData.avatar || "",
      content: sanitizedContent,
      attachment: attachmentUrl,
      likes: 0,
      likedBy: [],
      createdAt: new Date().toISOString(),
    };
    await database.ref(`events/${eventId}/comments/${commentId}`).set(comment);
    await eventRef.update({
      comments: (eventSnapshot.val().comments || 0) + 1,
    });
    res.status(201).json(comment);
  } catch (error) {
    console.error("Error creating event comment:", error.message, error.stack);
    res.status(500).json({ error: "Failed to create comment" });
  }
};

const createEventReply = async (req, res, next) => {
  try {
    const { eventId, commentId } = req.params;
    const userId = req.user.uid;
    if (!eventId || !commentId) {
      return res
        .status(400)
        .json({ error: "Event ID and Comment ID are required" });
    }
    if (!req.body.content && !req.file) {
      return res
        .status(400)
        .json({ error: "Reply content or attachment is required" });
    }
    const sanitizedContent = sanitizeInput(req.body.content) || "";
    const eventRef = database.ref(`events/${eventId}`);
    const eventSnapshot = await eventRef.once("value");
    if (!eventSnapshot.exists()) {
      return res.status(404).json({ error: "Event not found" });
    }
    const commentRef = database.ref(`events/${eventId}/comments/${commentId}`);
    const commentSnapshot = await commentRef.once("value");
    if (!commentSnapshot.exists()) {
      return res.status(404).json({ error: "Comment not found" });
    }
    const userRef = database.ref(`users/${userId}`);
    const userSnapshot = await userRef.once("value");
    if (!userSnapshot.exists()) {
      return res.status(404).json({ error: "User not found" });
    }
    const userData = userSnapshot.val();
    let attachmentUrl = "";
    if (req.file) {
      const file = req.file;
      if (!file.mimetype.startsWith("image/")) {
        return res.status(400).json({ error: "Only image files are allowed" });
      }
      const fileName = `events/${eventId}/comments/${commentId}/replies/${Date.now()}-${
        file.originalname
      }`;
      const fileRef = storage.bucket().file(fileName);
      await fileRef.save(file.buffer, { contentType: file.mimetype });
      [attachmentUrl] = await fileRef.getSignedUrl({
        action: "read",
        expires: "03-01-2500",
      });
    }
    const replyId = uuidv4();
    const reply = {
      id: replyId,
      eventId,
      commentId,
      authorId: userId,
      author: userData.username || userData.email.split("@")[0],
      authorImage: userData.avatar || "",
      content: sanitizedContent,
      attachment: attachmentUrl,
      likes: 0,
      likedBy: [],
      createdAt: new Date().toISOString(),
    };
    await database
      .ref(`events/${eventId}/comments/${commentId}/replies/${replyId}`)
      .set(reply);
    res.status(201).json(reply);
  } catch (error) {
    console.error("Error creating event reply:", error.message, error.stack);
    res.status(500).json({ error: "Failed to create reply" });
  }
};

const likeEventComment = async (req, res, next) => {
  try {
    const { eventId, commentId } = req.params;
    const userId = req.user.uid;
    if (!eventId || !commentId) {
      return res
        .status(400)
        .json({ error: "Event ID and Comment ID are required" });
    }
    const commentRef = database.ref(`events/${eventId}/comments/${commentId}`);
    const commentSnapshot = await commentRef.once("value");
    if (!commentSnapshot.exists()) {
      return res.status(404).json({ error: "Comment not found" });
    }
    const commentData = commentSnapshot.val();
    let likes = commentData.likes || 0;
    let likedBy = Array.isArray(commentData.likedBy) ? commentData.likedBy : [];
    if (likedBy.includes(userId)) {
      likes = Math.max(likes - 1, 0);
      likedBy = likedBy.filter((uid) => uid !== userId);
    } else {
      likes += 1;
      likedBy.push(userId);
    }
    await commentRef.update({ likes, likedBy });
    res.status(200).json({ message: "Comment like updated", likes, likedBy });
  } catch (error) {
    console.error("Error liking event comment:", error.message, error.stack);
    res.status(500).json({ error: "Failed to update comment like" });
  }
};

const likeEventReply = async (req, res, next) => {
  try {
    const { eventId, commentId, replyId } = req.params;
    const userId = req.user.uid;
    if (!eventId || !commentId || !replyId) {
      return res
        .status(400)
        .json({ error: "Event ID, Comment ID, and Reply ID are required" });
    }
    const replyRef = database.ref(
      `events/${eventId}/comments/${commentId}/replies/${replyId}`
    );
    const replySnapshot = await replyRef.once("value");
    if (!replySnapshot.exists()) {
      return res.status(404).json({ error: "Reply not found" });
    }
    const replyData = replySnapshot.val();
    let likes = replyData.likes || 0;
    let likedBy = Array.isArray(replyData.likedBy) ? replyData.likedBy : [];
    if (likedBy.includes(userId)) {
      likes = Math.max(likes - 1, 0);
      likedBy = likedBy.filter((uid) => uid !== userId);
    } else {
      likes += 1;
      likedBy.push(userId);
    }
    await replyRef.update({ likes, likedBy });
    res.status(200).json({ message: "Reply like updated", likes, likedBy });
  } catch (error) {
    console.error("Error liking event reply:", error.message, error.stack);
    res.status(500).json({ error: "Failed to update reply like" });
  }
};

module.exports = {
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
};
