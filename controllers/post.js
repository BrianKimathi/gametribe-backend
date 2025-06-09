const { database, storage } = require("../config/firebase");
const { v4: uuidv4 } = require("uuid");
const DOMPurify = require("dompurify");
const { JSDOM } = require("jsdom");
const window = new JSDOM("").window;
const purify = DOMPurify(window);

// Sanitize input to prevent XSS or invalid data and remove unnecessary HTML tags
const sanitizeInput = (input) => {
  if (typeof input !== "string") return input;
  // Sanitize and remove <p> tags if they are the only wrapper
  let sanitized = purify.sanitize(input, {
    ALLOWED_TAGS: ["b", "i", "u", "strong", "em"],
  });
  // Remove wrapping <p> tags if they enclose the entire content
  if (sanitized.startsWith("<p>") && sanitized.endsWith("</p>")) {
    sanitized = sanitized.slice(3, -4).trim();
  }
  return sanitized;
};

const getPosts = async (req, res) => {
  try {
    const userId = req.user?.uid;
    const postsRef = database.ref("posts");
    const snapshot = await postsRef.orderByChild("createdAt").once("value");
    const postsData = snapshot.val() || {};
    const posts = Object.entries(postsData).map(([id, data]) => ({
      id,
      ...data,
      likes: data.likes || 0,
      likedBy: Array.isArray(data.likedBy) ? data.likedBy : [],
      liked:
        userId && Array.isArray(data.likedBy)
          ? data.likedBy.includes(userId)
          : false,
    }));
    posts.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return res.status(200).json({ posts });
  } catch (error) {
    console.error("Error fetching posts:", error.message, error.stack);
    return res.status(500).json({ error: "Failed to fetch posts" });
  }
};

const createPost = async (req, res) => {
  try {
    const userId = req.user.uid;
    const { content, category, imageLink } = req.body;
    if (
      !content ||
      typeof content !== "string" ||
      content.trim().length === 0
    ) {
      return res.status(400).json({
        error: "Post content is required and must be a non-empty string",
      });
    }
    const sanitizedContent = sanitizeInput(content);
    const userRef = database.ref(`users/${userId}`);
    const userSnapshot = await userRef.once("value");
    if (!userSnapshot.exists()) {
      return res.status(404).json({ error: "User not found" });
    }
    const userData = userSnapshot.val();
    let imageUrl = sanitizeInput(imageLink) || "";
    if (req.file) {
      const file = req.file;
      if (!file.mimetype.startsWith("image/")) {
        return res.status(400).json({ error: "Only image files are allowed" });
      }
      const fileName = `posts/${Date.now()}-${file.originalname}`;
      const fileRef = storage.bucket().file(fileName);
      await fileRef.save(file.buffer, { contentType: file.mimetype });
      [imageUrl] = await fileRef.getSignedUrl({
        action: "read",
        expires: "03-09-2491",
      });
    }
    const postId = uuidv4();
    const newPost = {
      authorId: userId,
      author: userData.username || userData.email.split("@")[0],
      authorImage: userData.avatar || "",
      content: sanitizedContent,
      category: sanitizeInput(category) || "",
      image: imageUrl,
      createdAt: new Date().toISOString(),
      comments: 0,
      likes: 0,
      likedBy: [],
    };
    await database.ref(`posts/${postId}`).set(newPost);
    return res.status(201).json({ id: postId, ...newPost });
  } catch (error) {
    console.error("Error creating post:", error.message, error.stack);
    return res.status(500).json({ error: "Failed to create post" });
  }
};

const likePost = async (req, res) => {
  try {
    const postId = req.params.id;
    const userId = req.user.uid;
    if (!postId) {
      return res.status(400).json({ error: "Post ID is required" });
    }
    const postRef = database.ref(`posts/${postId}`);
    const result = await postRef.transaction((postData) => {
      if (!postData) {
        return null;
      }
      const likedBy = Array.isArray(postData.likedBy) ? postData.likedBy : [];
      const likes = postData.likes || 0;
      const isLiked = likedBy.includes(userId);
      if (isLiked) {
        postData.likes = likes > 0 ? likes - 1 : 0;
        postData.likedBy = likedBy.filter((id) => id !== userId);
      } else {
        postData.likes = likes + 1;
        postData.likedBy = [...new Set([...likedBy, userId])];
      }
      return postData;
    });
    if (!result.committed) {
      return res.status(404).json({ error: "Post not found" });
    }
    const postData = result.snapshot.val();
    return res.status(200).json({
      liked: postData.likedBy.includes(userId),
      likes: postData.likes,
    });
  } catch (error) {
    console.error("Error liking post:", error.message, error.stack);
    return res.status(500).json({ error: "Failed to like post" });
  }
};

const getComments = async (req, res) => {
  try {
    const postId = req.params.postId;
    if (!postId) {
      return res.status(400).json({ error: "Post ID is required" });
    }
    const postRef = database.ref(`posts/${postId}`);
    const postSnapshot = await postRef.once("value");
    if (!postSnapshot.exists()) {
      return res.status(404).json({ error: "Post not found" });
    }
    const commentsRef = database.ref(`posts/${postId}/comments`);
    const commentsSnapshot = await commentsRef
      .orderByChild("createdAt")
      .once("value");
    const commentsData = commentsSnapshot.val() || {};
    const comments = [];
    for (const [commentId, commentData] of Object.entries(commentsData)) {
      const repliesRef = database.ref(
        `posts/${postId}/comments/${commentId}/replies`
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
    return res.status(200).json(comments);
  } catch (error) {
    console.error("Error fetching comments:", error.message, error.stack);
    return res.status(500).json({ error: "Failed to fetch comments" });
  }
};

const createComment = async (req, res) => {
  try {
    const postId = req.params.postId;
    const userId = req.user.uid;
    if (!postId) {
      return res.status(400).json({ error: "Post ID is required" });
    }
    if (!req.body.content && !req.file) {
      return res
        .status(400)
        .json({ error: "Comment content or attachment is required" });
    }
    const sanitizedContent = sanitizeInput(req.body.content) || "";
    const postRef = database.ref(`posts/${postId}`);
    const postSnapshot = await postRef.once("value");
    if (!postSnapshot.exists()) {
      return res.status(404).json({ error: "Post not found" });
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
      const fileName = `posts/${postId}/comments/${Date.now()}-${
        file.originalname
      }`;
      const fileRef = storage.bucket().file(fileName);
      await fileRef.save(file.buffer, { contentType: file.mimetype });
      [attachmentUrl] = await fileRef.getSignedUrl({
        action: "read",
        expires: "03-09-2491",
      });
    }
    const commentId = uuidv4();
    const comment = {
      id: commentId,
      postId,
      authorId: userId,
      author: userData.username || userData.email.split("@")[0],
      authorImage: userData.avatar || "",
      content: sanitizedContent,
      attachment: attachmentUrl,
      likes: 0,
      likedBy: [],
      createdAt: new Date().toISOString(),
    };
    await database.ref(`posts/${postId}/comments/${commentId}`).set(comment);
    await postRef.update({ comments: (postSnapshot.val().comments || 0) + 1 });
    return res.status(201).json(comment);
  } catch (error) {
    console.error("Error creating comment:", error.message, error.stack);
    return res.status(500).json({ error: "Failed to create comment" });
  }
};

const createReply = async (req, res) => {
  try {
    const { postId, commentId } = req.params;
    const userId = req.user.uid;
    if (!postId || !commentId) {
      return res
        .status(400)
        .json({ error: "Post ID and Comment ID are required" });
    }
    if (!req.body.content && !req.file) {
      return res
        .status(400)
        .json({ error: "Reply content or attachment is required" });
    }
    const sanitizedContent = sanitizeInput(req.body.content) || "";
    const postRef = database.ref(`posts/${postId}`);
    const postSnapshot = await postRef.once("value");
    if (!postSnapshot.exists()) {
      return res.status(404).json({ error: "Post not found" });
    }
    const commentRef = database.ref(`posts/${postId}/comments/${commentId}`);
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
      const fileName = `posts/${postId}/comments/${commentId}/replies/${Date.now()}-${
        file.originalname
      }`;
      const fileRef = storage.bucket().file(fileName);
      await fileRef.save(file.buffer, { contentType: file.mimetype });
      [attachmentUrl] = await fileRef.getSignedUrl({
        action: "read",
        expires: "03-09-2491",
      });
    }
    const replyId = uuidv4();
    const reply = {
      id: replyId,
      postId,
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
      .ref(`posts/${postId}/comments/${commentId}/replies/${replyId}`)
      .set(reply);
    await postRef.update({ comments: (postSnapshot.val().comments || 0) + 1 });
    return res.status(201).json(reply);
  } catch (error) {
    console.error("Error creating reply:", error.message, error.stack);
    return res.status(500).json({ error: "Failed to create reply" });
  }
};

const likeComment = async (req, res) => {
  try {
    const { postId, commentId } = req.params;
    const userId = req.user.uid;
    if (!postId || !commentId) {
      return res
        .status(400)
        .json({ error: "Post ID and Comment ID are required" });
    }
    const commentRef = database.ref(`posts/${postId}/comments/${commentId}`);
    const result = await commentRef.transaction((commentData) => {
      if (!commentData) {
        return null;
      }
      const likedBy = Array.isArray(commentData.likedBy)
        ? commentData.likedBy
        : [];
      const likes = commentData.likes || 0;
      const isLiked = likedBy.includes(userId);
      if (isLiked) {
        commentData.likes = likes > 0 ? likes - 1 : 0;
        commentData.likedBy = likedBy.filter((id) => id !== userId);
      } else {
        commentData.likes = likes + 1;
        commentData.likedBy = [...new Set([...likedBy, userId])];
      }
      return commentData;
    });
    if (!result.committed) {
      return res.status(404).json({ error: "Comment not found" });
    }
    const commentData = result.snapshot.val();
    return res.status(200).json({
      liked: commentData.likedBy.includes(userId),
      likes: commentData.likes,
    });
  } catch (error) {
    console.error("Error liking comment:", error.message, error.stack);
    return res.status(500).json({ error: "Failed to like comment" });
  }
};

const likeReply = async (req, res) => {
  try {
    const { postId, commentId, replyId } = req.params;
    const userId = req.user.uid;
    if (!postId || !commentId || !replyId) {
      return res
        .status(400)
        .json({ error: "Post ID, Comment ID, and Reply ID are required" });
    }
    const replyRef = database.ref(
      `posts/${postId}/comments/${commentId}/replies/${replyId}`
    );
    const result = await replyRef.transaction((replyData) => {
      if (!replyData) {
        return null;
      }
      const likedBy = Array.isArray(replyData.likedBy) ? replyData.likedBy : [];
      const likes = replyData.likes || 0;
      const isLiked = likedBy.includes(userId);
      if (isLiked) {
        replyData.likes = likes > 0 ? likes - 1 : 0;
        replyData.likedBy = likedBy.filter((id) => id !== userId);
      } else {
        replyData.likes = likes + 1;
        replyData.likedBy = [...new Set([...likedBy, userId])];
      }
      return replyData;
    });
    if (!result.committed) {
      return res.status(404).json({ error: "Reply not found" });
    }
    const replyData = result.snapshot.val();
    return res.status(200).json({
      liked: replyData.likedBy.includes(userId),
      likes: replyData.likes,
    });
  } catch (error) {
    console.error("Error liking reply:", error.message, error.stack);
    return res.status(500).json({ error: "Failed to like reply" });
  }
};

module.exports = {
  getPosts,
  createPost,
  likePost,
  getComments,
  createComment,
  createReply,
  likeComment,
  likeReply,
};
