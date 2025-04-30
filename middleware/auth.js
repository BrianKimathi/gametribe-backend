const { admin } = require("../config/firebase");

const authenticate = async (req, res, next) => {
  const token = req.headers.authorization?.split("Bearer ")[1];
  if (!token) {
    return res.status(401).json({ error: "No token provided" });
  }

  try {
    console.log("Verifying token:", token);
    const decodedToken = await admin.auth().verifyIdToken(token);
    console.log("Token verified successfully:", decodedToken);
    req.user = decodedToken;
    next();
  } catch (error) {
    console.error("Authentication error:", error.message);
    console.error("Error code:", error.code);
    return res
      .status(403)
      .json({ error: "Invalid token", details: error.message });
  }
};

module.exports = authenticate;
