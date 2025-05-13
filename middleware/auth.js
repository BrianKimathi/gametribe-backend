const { auth } = require("../config/firebase");

const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "No token provided" });
    }
    const token = authHeader.split("Bearer ")[1];
    console.log("Verifying token:", token);
    if (!auth) {
      console.error("Firebase Admin auth module is not initialized");
      return res.status(500).json({ error: "Server configuration error" });
    }
    const decodedToken = await auth.verifyIdToken(token);
    console.log("Token verified successfully:", decodedToken);
    req.user = decodedToken;
    next();
  } catch (error) {
    console.error("Authentication error:", {
      message: error.message,
      code: error.code,
      stack: error.stack,
    });
    return res.status(403).json({ error: "Invalid token" });
  }
};

module.exports = authenticate;
