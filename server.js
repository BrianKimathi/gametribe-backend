const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const postsRouter = require("./routes/posts");
const clansRouter = require("./routes/clans");
const usersRouter = require("./routes/users");

dotenv.config();

const app = express();

// Middleware
app.use(cors({ origin: "http://localhost:5173" }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use("/api/posts", postsRouter);
app.use("/api/clans", clansRouter);
app.use("/api/users", usersRouter);

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
