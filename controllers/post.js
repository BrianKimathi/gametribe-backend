const { db, storage } = require("../config/firebase");

const getPosts = async (req, res) => {
  try {
    const postsSnapshot = await db
      .collection("posts")
      .orderBy("createdAt", "desc")
      .get();
    const posts = [];
    for (const doc of postsSnapshot.docs) {
      const postData = { id: doc.id, ...doc.data() };
      const commentsSnapshot = await db
        .collection("posts")
        .doc(doc.id)
        .collection("comments")
        .get();
      postData.comments = commentsSnapshot.size;
      posts.push(postData);
    }
    return res.status(200).json(posts);
  } catch (error) {
    console.error("Error fetching posts:", error);
    return res.status(500).json({ error: "Failed to fetch posts" });
  }
};

const createPost = async (req, res) => {
  try {
    const userRef = db.collection("users").doc(req.user.uid);
    const userDoc = await userRef.get();
    if (!userDoc.exists) {
      return res.status(404).json({ error: "User not found" });
    }

    const userData = userDoc.data();
    let imageUrl = "";
    if (req.file) {
      const file = req.file;
      const fileName = `${Date.now()}_${file.originalname}`;
      const fileRef = storage.bucket().file(`posts/${fileName}`);
      await fileRef.save(file.buffer, { contentType: file.mimetype });
      imageUrl = await fileRef.getSignedUrl({
        action: "read",
        expires: "03-09-2491",
      });
      imageUrl = imageUrl[0];
    } else if (req.body.imageLink) {
      imageUrl = req.body.imageLink;
    }

    const newPost = {
      content: req.body.content,
      category: req.body.category || "",
      image: imageUrl,
      author: userData.username,
      authorImage: userData.avatar,
      time: new Date().toISOString(),
      likes: 0,
      liked: false,
      comments: 0,
      createdAt: new Date().toISOString(),
      link: `https://gametibe2025.web.app/post/${Date.now()}`,
    };

    const postRef = await db.collection("posts").add(newPost);
    return res.status(201).json({ id: postRef.id, ...newPost });
  } catch (error) {
    console.error("Error creating post:", error);
    return res.status(500).json({ error: "Failed to create post" });
  }
};

const likePost = async (req, res) => {
  try {
    const postId = req.params.id;
    const { liked, likes } = req.body;
    const postRef = db.collection("posts").doc(postId);
    await postRef.update({ liked, likes });
    return res.status(200).json({ message: "Post updated" });
  } catch (error) {
    console.error("Error updating post:", error);
    return res.status(500).json({ error: "Failed to update post" });
  }
};

const getComments = async (req, res) => {
  try {
    const postId = req.params.postId;
    const commentsSnapshot = await db
      .collection("posts")
      .doc(postId)
      .collection("comments")
      .orderBy("createdAt", "asc")
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
        .orderBy("createdAt", "asc")
        .get();
      commentData.replies = repliesSnapshot.docs.map((replyDoc) => ({
        id: replyDoc.id,
        ...replyDoc.data(),
      }));
      comments.push(commentData);
    }
    return res.status(200).json(comments);
  } catch (error) {
    console.error("Error fetching comments:", error);
    return res.status(500).json({ error: "Failed to fetch comments" });
  }
};

const createComment = async (req, res) => {
  try {
    const postId = req.params.postId;
    const userRef = db.collection("users").doc(req.user.uid);
    const userDoc = await userRef.get();
    if (!userDoc.exists) {
      return res.status(404).json({ error: "User not found" });
    }

    const userData = userDoc.data();
    let content = req.body.content;
    let attachmentUrl = "";

    // Handle both multipart/form-data and application/json
    if (
      !content &&
      req.headers["content-type"]?.startsWith("multipart/form-data")
    ) {
      content = req.body.content || "";
    }

    if (!content) {
      return res.status(400).json({ error: "Comment content is required" });
    }

    if (req.file) {
      const file = req.file;
      const fileName = `${Date.now()}_${file.originalname}`;
      const fileRef = storage.bucket().file(`comments/${fileName}`);
      await fileRef.save(file.buffer, { contentType: file.mimetype });
      attachmentUrl = await fileRef.getSignedUrl({
        action: "read",
        expires: "03-09-2491",
      });
      attachmentUrl = attachmentUrl[0];
    }

    const newComment = {
      author: userData.username,
      authorImage: userData.avatar,
      content: content,
      attachment: attachmentUrl,
      likes: 0,
      likedBy: [],
      createdAt: new Date().toISOString(),
    };

    const commentRef = await db
      .collection("posts")
      .doc(postId)
      .collection("comments")
      .add(newComment);

    // Update the post's comment count
    const postRef = db.collection("posts").doc(postId);
    const postDoc = await postRef.get();
    if (postDoc.exists) {
      const currentComments = postDoc.data().comments || 0;
      await postRef.update({ comments: currentComments + 1 });
    }

    return res.status(201).json({ id: commentRef.id, ...newComment });
  } catch (error) {
    console.error("Error creating comment:", error);
    return res.status(500).json({ error: "Failed to create comment" });
  }
};

const createReply = async (req, res) => {
  try {
    const { postId, commentId } = req.params;
    const userRef = db.collection("users").doc(req.user.uid);
    const userDoc = await userRef.get();
    if (!userDoc.exists) {
      return res.status(404).json({ error: "User not found" });
    }

    const userData = userDoc.data();
    let content = req.body.content;
    let attachmentUrl = "";

    // Handle both multipart/form-data and application/json
    if (
      !content &&
      req.headers["content-type"]?.startsWith("multipart/form-data")
    ) {
      content = req.body.content || "";
    }

    if (!content) {
      return res.status(400).json({ error: "Reply content is required" });
    }

    if (req.file) {
      const file = req.file;
      const fileName = `${Date.now()}_${file.originalname}`;
      const fileRef = storage.bucket().file(`comments/${fileName}`);
      await fileRef.save(file.buffer, { contentType: file.mimetype });
      attachmentUrl = await fileRef.getSignedUrl({
        action: "read",
        expires: "03-09-2491",
      });
      attachmentUrl = attachmentUrl[0];
    }

    const newReply = {
      author: userData.username,
      authorImage: userData.avatar,
      content: content,
      attachment: attachmentUrl,
      likes: 0,
      likedBy: [],
      createdAt: new Date().toISOString(),
    };

    const replyRef = await db
      .collection("posts")
      .doc(postId)
      .collection("comments")
      .doc(commentId)
      .collection("replies")
      .add(newReply);

    return res.status(201).json({ id: replyRef.id, ...newReply });
  } catch (error) {
    console.error("Error creating reply:", error);
    return res.status(500).json({ error: "Failed to create reply" });
  }
};

const likeComment = async (req, res) => {
  try {
    const { postId, commentId, replyId } = req.params;
    const userId = req.user.uid;
    let commentRef;

    if (replyId) {
      commentRef = db
        .collection("posts")
        .doc(postId)
        .collection("comments")
        .doc(commentId)
        .collection("replies")
        .doc(replyId);
    } else {
      commentRef = db
        .collection("posts")
        .doc(postId)
        .collection("comments")
        .doc(commentId);
    }

    const commentDoc = await commentRef.get();
    if (!commentDoc.exists) {
      return res.status(404).json({ error: "Comment or reply not found" });
    }

    const commentData = commentDoc.data();
    let updatedLikes = commentData.likes || 0;
    let updatedLikedBy = commentData.likedBy || [];

    if (updatedLikedBy.includes(userId)) {
      updatedLikes -= 1;
      updatedLikedBy = updatedLikedBy.filter((uid) => uid !== userId);
    } else {
      updatedLikes += 1;
      updatedLikedBy.push(userId);
    }

    await commentRef.update({
      likes: updatedLikes,
      likedBy: updatedLikedBy,
    });

    return res.status(200).json({
      likes: updatedLikes,
      liked: updatedLikedBy.includes(userId),
    });
  } catch (error) {
    console.error("Error liking comment:", error);
    return res.status(500).json({ error: "Failed to like comment" });
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
};
