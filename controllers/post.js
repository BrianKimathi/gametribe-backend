const { db, storage } = require("../config/firebase");
const { v4: uuidv4 } = require("uuid");
const admin = require("firebase-admin");

const getPosts = async (req, res) => {
  try {
    const userId = req.user?.uid;
    const postsSnapshot = await db
      .collection("posts")
      .orderBy("createdAt", "desc")
      .get();
    const posts = postsSnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
      likes: doc.data().likes || 0,
      likedBy: doc.data().likedBy || [],
      liked: userId ? doc.data().likedBy?.includes(userId) || false : false,
    }));
    return res.status(200).json({ posts });
  } catch (error) {
    console.error("Error fetching posts:", error);
    return res.status(500).json({ error: "Failed to fetch posts" });
  }
};

const createPost = async (req, res) => {
  try {
    const userId = req.user.uid;
    const { content, category, imageLink } = req.body;
    if (!content) {
      return res.status(400).json({ error: "Post content is required" });
    }
    const userRef = db.collection("users").doc(userId);
    const userDoc = await userRef.get();
    if (!userDoc.exists) {
      return res.status(404).json({ error: "User not found" });
    }
    const userData = userDoc.data();
    let imageUrl = imageLink || "";
    if (req.file) {
      const file = req.file;
      const fileName = `posts/${Date.now()}-${file.originalname}`;
      const fileRef = storage.bucket().file(fileName);
      await fileRef.save(file.buffer, { contentType: file.mimetype });
      [imageUrl] = await fileRef.getSignedUrl({
        action: "read",
        expires: "03-09-2491",
      });
    }
    const newPost = {
      authorId: userId,
      author: userData.username || userData.email.split("@")[0],
      authorImage: userData.avatar || "",
      content,
      category,
      image: imageUrl,
      createdAt: new Date().toISOString(),
      comments: 0,
      likes: 0, // Initialize likes
      likedBy: [], // Initialize likedBy
    };
    const docRef = await db.collection("posts").add(newPost);
    return res.status(201).json({ id: docRef.id, ...newPost });
  } catch (error) {
    console.error("Error creating post:", error);
    return res.status(500).json({ error: "Failed to create post" });
  }
};

const likePost = async (req, res) => {
  try {
    console.log("Received like POST request:", {
      url: req.originalUrl,
      params: req.params,
      userId: req.user.uid,
    });
    const postId = req.params.id;
    const userId = req.user.uid;
    if (!postId || typeof postId !== "string" || postId.trim() === "") {
      console.error("Invalid or missing postId:", postId);
      return res.status(400).json({ error: "Post ID is required" });
    }
    console.log(`Liking post ${postId} by user ${userId}`);
    const postRef = db.collection("posts").doc(postId);
    const result = await db.runTransaction(async (transaction) => {
      const postDoc = await transaction.get(postRef);
      if (!postDoc.exists) {
        console.error(`Post not found: ${postId}`);
        throw new Error("Post not found");
      }
      const postData = postDoc.data();
      const likedBy = postData.likedBy || [];
      const likes = postData.likes || 0;
      let newLikes = likes;
      let isLiked = likedBy.includes(userId);
      console.log(
        `Current post state: likes=${likes}, likedBy=${likedBy}, isLiked=${isLiked}`
      );
      if (isLiked) {
        newLikes = likes > 0 ? likes - 1 : 0;
        transaction.update(postRef, {
          likes: newLikes,
          likedBy: likedBy.filter((id) => id !== userId),
        });
        console.log(`Unliked: newLikes=${newLikes}, removed user ${userId}`);
      } else {
        newLikes = likes + 1;
        transaction.update(postRef, {
          likes: newLikes,
          likedBy: [...likedBy, userId],
        });
        console.log(`Liked: newLikes=${newLikes}, added user ${userId}`);
      }
      return { liked: !isLiked, likes: newLikes };
    });
    console.log(`Like operation successful: postId=${postId}, result=`, result);
    return res.status(200).json(result);
  } catch (error) {
    console.error("Error liking post:", {
      postId: req.params.id || "undefined",
      userId: req.user?.uid || "unknown",
      message: error.message,
      code: error.code,
      stack: error.stack,
    });
    return res.status(error.message === "Post not found" ? 404 : 500).json({
      error:
        error.message === "Post not found"
          ? "Post not found"
          : "Failed to like post",
    });
  }
};

const getComments = async (req, res) => {
  try {
    console.log("Received get comments request:", {
      url: req.originalUrl,
      params: req.params,
    });
    const postId = req.params.postId;
    if (!postId || typeof postId !== "string" || postId.trim() === "") {
      console.error("Invalid or missing postId:", postId);
      return res.status(400).json({ error: "Post ID is required" });
    }
    const postRef = db.collection("posts").doc(postId);
    const postDoc = await postRef.get();
    if (!postDoc.exists) {
      console.error(`Post not found: ${postId}`);
      return res.status(404).json({ error: "Post not found" });
    }
    const commentsSnapshot = await db
      .collection("posts")
      .doc(postId)
      .collection("comments")
      .orderBy("createdAt", "desc")
      .get();
    const comments = [];
    for (const doc of commentsSnapshot.docs) {
      const commentData = { id: doc.id, ...doc.data() };
      const repliesSnapshot = await db
        .collection("posts")
        .doc(postId)
        .collection("comments")
        .doc(doc.id)
        .collection("replies")
        .orderBy("createdAt", "desc")
        .get();
      commentData.replies = repliesSnapshot.docs.map((replyDoc) => ({
        id: replyDoc.id,
        ...replyDoc.data(),
      }));
      comments.push(commentData);
    }
    console.log(`Fetched comments for post ${postId}:`, comments);
    return res.status(200).json(comments);
  } catch (error) {
    console.error("Error fetching comments:", {
      postId: req.params.postId || "undefined",
      message: error.message,
      code: error.code,
      stack: error.stack,
    });
    return res.status(500).json({ error: "Failed to fetch comments" });
  }
};

const createComment = async (req, res) => {
  try {
    console.log("Received comment POST request:", {
      url: req.originalUrl,
      params: req.params,
      body: req.body,
      hasFile: !!req.file,
    });
    const postId = req.params.postId;
    const userId = req.user.uid;
    if (!postId || typeof postId !== "string" || postId.trim() === "") {
      console.error("Invalid or missing postId:", postId);
      return res.status(400).json({ error: "Post ID is required" });
    }
    console.log(`Creating comment for post ${postId} by user ${userId}`, {
      content: req.body.content,
      hasFile: !!req.file,
    });
    if (!req.body.content && !req.file) {
      console.error("Comment content or attachment missing");
      return res
        .status(400)
        .json({ error: "Comment content or attachment is required" });
    }
    const postRef = db.collection("posts").doc(postId);
    const postDoc = await postRef.get();
    if (!postDoc.exists) {
      console.error(`Post not found: ${postId}`);
      return res.status(404).json({ error: "Post not found" });
    }
    const userRef = db.collection("users").doc(userId);
    const userDoc = await userRef.get();
    if (!userDoc.exists) {
      console.error(`User not found: ${userId}`);
      return res.status(404).json({ error: "User not found" });
    }
    const userData = userDoc.data();
    let attachmentUrl = "";
    if (req.file) {
      const file = req.file;
      const fileName = `posts/${postId}/comments/${Date.now()}-${
        file.originalname
      }`;
      const fileRef = storage.bucket().file(fileName);
      await fileRef.save(file.buffer, { contentType: file.mimetype });
      [attachmentUrl] = await fileRef.getSignedUrl({
        action: "read",
        expires: "03-09-2491",
      });
      console.log("Uploaded attachment:", attachmentUrl);
    }
    const commentId = db.collection("posts").doc().id;
    if (
      !commentId ||
      typeof commentId !== "string" ||
      commentId.trim() === ""
    ) {
      console.error("Failed to generate valid comment ID");
      return res.status(500).json({ error: "Failed to generate comment ID" });
    }
    const comment = {
      id: commentId,
      postId,
      authorId: userId,
      author: userData.username || userData.email.split("@")[0],
      authorImage: userData.avatar || "",
      content: req.body.content || "",
      attachment: attachmentUrl,
      likes: 0,
      likedBy: [],
      createdAt: new Date().toISOString(),
    };
    console.log(
      `Attempting to save comment: commentId=${commentId}, postId=${postId}`
    );
    await db
      .collection("posts")
      .doc(postId)
      .collection("comments")
      .doc(commentId)
      .set(comment);
    await postRef.update({ comments: admin.firestore.FieldValue.increment(1) });
    console.log(`Comment created: commentId=${commentId}, postId=${postId}`);
    return res.status(201).json(comment);
  } catch (error) {
    console.error("Error creating comment:", {
      postId: req.params.postId || "undefined",
      userId: req.user?.uid || "unknown",
      message: error.message,
      code: error.code,
      stack: error.stack,
    });
    return res.status(500).json({ error: "Failed to create comment" });
  }
};

const createReply = async (req, res) => {
  try {
    console.log("Received reply POST request:", {
      url: req.originalUrl,
      params: req.params,
      body: req.body,
      hasFile: !!req.file,
    });
    const { postId, commentId } = req.params;
    const userId = req.user.uid;
    if (!postId || !commentId) {
      console.error("Missing postId or commentId:", { postId, commentId });
      return res
        .status(400)
        .json({ error: "Post ID and Comment ID are required" });
    }
    console.log(
      `Creating reply for comment ${commentId} on post ${postId} by user ${userId}`,
      {
        content: req.body.content,
        hasFile: !!req.file,
      }
    );
    if (!req.body.content && !req.file) {
      console.error("Reply content or attachment missing");
      return res
        .status(400)
        .json({ error: "Reply content or attachment is required" });
    }
    const postRef = db.collection("posts").doc(postId);
    const postDoc = await postRef.get();
    if (!postDoc.exists) {
      console.error(`Post not found: ${postId}`);
      return res.status(404).json({ error: "Post not found" });
    }
    const commentRef = db
      .collection("posts")
      .doc(postId)
      .collection("comments")
      .doc(commentId);
    const commentDoc = await commentRef.get();
    if (!commentDoc.exists) {
      console.error(`Comment not found: ${commentId}`);
      return res.status(404).json({ error: "Comment not found" });
    }
    const userRef = db.collection("users").doc(userId);
    const userDoc = await userRef.get();
    if (!userDoc.exists) {
      console.error(`User not found: ${userId}`);
      return res.status(404).json({ error: "User not found" });
    }
    const userData = userDoc.data();
    let attachmentUrl = "";
    if (req.file) {
      const file = req.file;
      const fileName = `posts/${postId}/comments/${commentId}/replies/${Date.now()}-${
        file.originalname
      }`;
      const fileRef = storage.bucket().file(fileName);
      await fileRef.save(file.buffer, { contentType: file.mimetype });
      [attachmentUrl] = await fileRef.getSignedUrl({
        action: "read",
        expires: "03-09-2491",
      });
      console.log("Uploaded attachment:", attachmentUrl);
    }
    const replyId = db.collection("posts").doc().id;
    if (!replyId || typeof replyId !== "string" || replyId.trim() === "") {
      console.error("Failed to generate valid reply ID");
      return res.status(500).json({ error: "Failed to generate reply ID" });
    }
    const reply = {
      id: replyId,
      postId,
      commentId,
      authorId: userId,
      author: userData.username || userData.email.split("@")[0],
      authorImage: userData.avatar || "",
      content: req.body.content || "",
      attachment: attachmentUrl,
      likes: 0,
      likedBy: [],
      createdAt: new Date().toISOString(),
    };
    console.log(
      `Attempting to save reply: replyId=${replyId}, commentId=${commentId}, postId=${postId}`
    );
    await db
      .collection("posts")
      .doc(postId)
      .collection("comments")
      .doc(commentId)
      .collection("replies")
      .doc(replyId)
      .set(reply);
    await postRef.update({ comments: admin.firestore.FieldValue.increment(1) });
    console.log(
      `Reply created: replyId=${replyId}, commentId=${commentId}, postId=${postId}`
    );
    return res.status(201).json(reply);
  } catch (error) {
    console.error("Error creating reply:", {
      postId: req.params.postId || "undefined",
      commentId: req.params.commentId || "undefined",
      userId: req.user?.uid || "unknown",
      message: error.message,
      code: error.code,
      stack: error.stack,
    });
    return res.status(500).json({ error: "Failed to create reply" });
  }
};

const likeComment = async (req, res) => {
  try {
    console.log("Received like comment request:", {
      url: req.originalUrl,
      params: req.params,
      userId: req.user.uid,
    });
    const { postId, commentId } = req.params;
    const userId = req.user.uid;
    if (!postId || !commentId) {
      console.error("Missing postId or commentId:", { postId, commentId });
      return res
        .status(400)
        .json({ error: "Post ID and Comment ID are required" });
    }
    console.log(
      `Liking comment ${commentId} on post ${postId} by user ${userId}`
    );
    const commentRef = db
      .collection("posts")
      .doc(postId)
      .collection("comments")
      .doc(commentId);
    const result = await db.runTransaction(async (transaction) => {
      const commentDoc = await transaction.get(commentRef);
      if (!commentDoc.exists) {
        console.error(`Comment not found: ${commentId}`);
        throw new Error("Comment not found");
      }
      const commentData = commentDoc.data();
      const likedBy = commentData.likedBy || [];
      const likes = commentData.likes || 0;
      if (likedBy.includes(userId)) {
        console.log(`User ${userId} has already liked comment ${commentId}`);
        return { liked: true, likes }; // No change
      }
      const newLikes = likes + 1;
      transaction.update(commentRef, {
        likes: newLikes,
        likedBy: [...likedBy, userId],
      });
      console.log(
        `Liked comment: commentId=${commentId}, newLikes=${newLikes}, added user ${userId}`
      );
      return { liked: true, likes: newLikes };
    });
    console.log(
      `Like comment successful: commentId=${commentId}, result=`,
      result
    );
    return res.status(200).json(result);
  } catch (error) {
    console.error("Error liking comment:", {
      postId: req.params.postId || "undefined",
      commentId: req.params.commentId || "undefined",
      userId: req.user?.uid || "unknown",
      message: error.message,
      code: error.code,
      stack: error.stack,
    });
    return res.status(error.message === "Comment not found" ? 404 : 500).json({
      error:
        error.message === "Comment not found"
          ? "Comment not found"
          : "Failed to like comment",
    });
  }
};

const likeReply = async (req, res) => {
  try {
    console.log("Received like reply request:", {
      url: req.originalUrl,
      params: req.params,
      userId: req.user.uid,
    });
    const { postId, commentId, replyId } = req.params;
    const userId = req.user.uid;
    if (!postId || !commentId || !replyId) {
      console.error("Missing postId, commentId, or replyId:", {
        postId,
        commentId,
        replyId,
      });
      return res
        .status(400)
        .json({ error: "Post ID, Comment ID, and Reply ID are required" });
    }
    console.log(
      `Liking reply ${replyId} on comment ${commentId} by user ${userId}`
    );
    const replyRef = db
      .collection("posts")
      .doc(postId)
      .collection("comments")
      .doc(commentId)
      .collection("replies")
      .doc(replyId);
    const result = await db.runTransaction(async (transaction) => {
      const replyDoc = await transaction.get(replyRef);
      if (!replyDoc.exists) {
        console.error(`Reply not found: ${replyId}`);
        throw new Error("Reply not found");
      }
      const replyData = replyDoc.data();
      const likedBy = replyData.likedBy || [];
      const likes = replyData.likes || 0;
      if (likedBy.includes(userId)) {
        console.log(`User ${userId} has already liked reply ${replyId}`);
        return { liked: true, likes }; // No change
      }
      const newLikes = likes + 1;
      transaction.update(replyRef, {
        likes: newLikes,
        likedBy: [...likedBy, userId],
      });
      console.log(
        `Liked reply: replyId=${replyId}, newLikes=${newLikes}, added user ${userId}`
      );
      return { liked: true, likes: newLikes };
    });
    console.log(`Like reply successful: replyId=${replyId}, result=`, result);
    return res.status(200).json(result);
  } catch (error) {
    console.error("Error liking reply:", {
      postId: req.params.postId || "undefined",
      commentId: req.params.commentId || "undefined",
      replyId: req.params.replyId || "undefined",
      userId: req.user?.uid || "unknown",
      message: error.message,
      code: error.code,
      stack: error.stack,
    });
    return res.status(error.message === "Reply not found" ? 404 : 500).json({
      error:
        error.message === "Reply not found"
          ? "Reply not found"
          : "Failed to like reply",
    });
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
