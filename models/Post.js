class Post {
  constructor({
    id,
    authorId,
    authorName,
    authorImage,
    time,
    category,
    content,
    image,
    likes = 0,
    likedBy = [],
    comments = 0,
    link,
    createdAt = new Date().toISOString(),
    repostCount = 0,
    repostedBy = [],
    isRepost = false,
    originalPostId = null,
    originalPost = null,
  }) {
    this.id = id;
    this.authorId = authorId;
    this.authorName = authorName;
    this.authorImage = authorImage;
    this.time = time;
    this.category = category;
    this.content = content;
    this.image = image;
    this.likes = likes;
    this.likedBy = likedBy; // Array of user IDs who liked the post
    this.comments = comments;
    this.link = link;
    this.createdAt = createdAt;
    this.repostCount = repostCount;
    this.repostedBy = repostedBy; // Array of user IDs who reposted
    this.isRepost = isRepost;
    this.originalPostId = originalPostId;
    this.originalPost = originalPost;
  }

  toFirestore() {
    return {
      authorId: this.authorId,
      authorName: this.authorName,
      authorImage: this.authorImage,
      time: this.time,
      category: this.category,
      content: this.content,
      image: this.image,
      likes: this.likes,
      likedBy: this.likedBy,
      comments: this.comments,
      link: this.link,
      createdAt: this.createdAt,
      repostCount: this.repostCount,
      repostedBy: this.repostedBy,
      isRepost: this.isRepost,
      originalPostId: this.originalPostId,
      originalPost: this.originalPost,
    };
  }

  static fromFirestore(data, id) {
    return new Post({
      id,
      authorId: data.authorId,
      authorName: data.authorName,
      authorImage: data.authorImage,
      time: data.time,
      category: data.category,
      content: data.content,
      image: data.image,
      likes: data.likes,
      likedBy: data.likedBy,
      comments: data.comments,
      link: data.link,
      createdAt: data.createdAt,
      repostCount: data.repostCount,
      repostedBy: data.repostedBy,
      isRepost: data.isRepost,
      originalPostId: data.originalPostId,
      originalPost: data.originalPost,
    });
  }
}

module.exports = Post;
