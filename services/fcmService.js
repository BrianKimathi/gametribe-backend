const admin = require("firebase-admin");
const { database } = require("../config/firebase");
const { ref, get } = require("firebase/database");
const { createLogger } = require("../utils/logger");
const log = createLogger("fcm");

/**
 * FCM Notification Service
 * Sends push notifications via Firebase Cloud Messaging
 */

/**
 * Get FCM token for a user
 */
const getUserFCMToken = async (userId) => {
  try {
    const userRef = ref(database, `users/${userId}/fcmToken`);
    const snapshot = await get(userRef);
    return snapshot.exists() ? snapshot.val() : null;
  } catch (error) {
    log.error("Error getting FCM token", { userId, error: error.message });
    return null;
  }
};

/**
 * Get user display name for notifications
 */
const getUserDisplayName = async (userId) => {
  try {
    const userRef = ref(database, `users/${userId}`);
    const snapshot = await get(userRef);
    if (snapshot.exists()) {
      const userData = snapshot.val();
      return userData.displayName || userData.username || "Someone";
    }
    return "Someone";
  } catch (error) {
    log.error("Error getting user display name", { userId, error: error.message });
    return "Someone";
  }
};

/**
 * Send FCM notification
 */
const sendNotification = async (fcmToken, notification, data = {}) => {
  if (!fcmToken) {
    log.warn("No FCM token provided, skipping notification");
    return false;
  }

  try {
    const message = {
      token: fcmToken,
      notification: {
        title: notification.title,
        body: notification.body,
      },
      data: {
        ...data,
        click_action: "FLUTTER_NOTIFICATION_CLICK",
      },
      android: {
        priority: "high",
        notification: {
          sound: "default",
          channelId: "high_importance_channel",
          priority: "high",
          defaultSound: true,
          defaultVibrateTimings: true,
        },
      },
      apns: {
        payload: {
          aps: {
            sound: "default",
            badge: 1,
          },
        },
      },
    };

    const response = await admin.messaging().send(message);
    log.info("FCM notification sent successfully", {
      messageId: response,
      fcmToken: fcmToken.substring(0, 20) + "...",
    });
    return true;
  } catch (error) {
    log.error("Error sending FCM notification", {
      error: error.message,
      code: error.code,
    });
    return false;
  }
};

/**
 * Send challenge created notification
 */
const sendChallengeCreatedNotification = async (challengerId, challengedId, challengeData) => {
  try {
    const fcmToken = await getUserFCMToken(challengedId);
    if (!fcmToken) {
      log.info("No FCM token for challenged user, skipping notification", { challengedId });
      return;
    }

    const challengerName = await getUserDisplayName(challengerId);
    const amount = challengeData.betAmount || 0;

    await sendNotification(
      fcmToken,
      {
        title: "🎯 New Challenge!",
        body: `You have received a challenge from ${challengerName}\nAmount: KES ${amount}`,
      },
      {
        type: "challenge_created",
        challengeId: challengeData.challengeId || challengeData.id,
        challengerId: challengerId,
        gameId: challengeData.gameId || "",
        gameTitle: challengeData.gameTitle || "",
      }
    );
  } catch (error) {
    log.error("Error sending challenge created notification", { error: error.message });
  }
};

/**
 * Send challenge accepted notification
 */
const sendChallengeAcceptedNotification = async (challengerId, challengedId, challengeData) => {
  try {
    const fcmToken = await getUserFCMToken(challengerId);
    if (!fcmToken) {
      log.info("No FCM token for challenger, skipping notification", { challengerId });
      return;
    }

    const challengedName = await getUserDisplayName(challengedId);

    await sendNotification(
      fcmToken,
      {
        title: "✅ Challenge Accepted!",
        body: `${challengedName} accepted your challenge. Start playing now!`,
      },
      {
        type: "challenge_accepted",
        challengeId: challengeData.challengeId || challengeData.id,
        challengedId: challengedId,
        gameId: challengeData.gameId || "",
      }
    );
  } catch (error) {
    log.error("Error sending challenge accepted notification", { error: error.message });
  }
};

/**
 * Send challenge rejected notification
 */
const sendChallengeRejectedNotification = async (challengerId, challengedId, challengeData) => {
  try {
    const fcmToken = await getUserFCMToken(challengerId);
    if (!fcmToken) {
      log.info("No FCM token for challenger, skipping notification", { challengerId });
      return;
    }

    const challengedName = await getUserDisplayName(challengedId);

    await sendNotification(
      fcmToken,
      {
        title: "❌ Challenge Rejected",
        body: `${challengedName} rejected your challenge`,
      },
      {
        type: "challenge_rejected",
        challengeId: challengeData.challengeId || challengeData.id,
        challengedId: challengedId,
      }
    );
  } catch (error) {
    log.error("Error sending challenge rejected notification", { error: error.message });
  }
};

/**
 * Send challenge completed notification
 */
const sendChallengeCompletedNotification = async (userId, opponentId, challengeData) => {
  try {
    const fcmToken = await getUserFCMToken(userId);
    if (!fcmToken) {
      log.info("No FCM token for user, skipping notification", { userId });
      return;
    }

    const opponentName = await getUserDisplayName(opponentId);
    const winnerId = challengeData.winnerId;
    const isWinner = winnerId === userId;
    const isTie = winnerId === "tie";

    let title, body;
    if (isTie) {
      title = "🤝 Challenge Tied!";
      body = `You tied with ${opponentName}. Well played!`;
    } else if (isWinner) {
      title = "🎉 You Won!";
      body = `Congratulations! You won the challenge against ${opponentName}`;
    } else {
      title = "💪 Challenge Completed";
      body = `${opponentName} won this challenge. Keep practicing!`;
    }

    await sendNotification(
      fcmToken,
      { title, body },
      {
        type: "challenge_completed",
        challengeId: challengeData.challengeId || challengeData.id,
        opponentId: opponentId,
        winnerId: winnerId,
        isWinner: isWinner.toString(),
      }
    );
  } catch (error) {
    log.error("Error sending challenge completed notification", { error: error.message });
  }
};

/**
 * Send score updated notification (when opponent plays)
 */
const sendScoreUpdatedNotification = async (userId, opponentId, challengeData) => {
  try {
    const fcmToken = await getUserFCMToken(userId);
    if (!fcmToken) {
      log.info("No FCM token for user, skipping notification", { userId });
      return;
    }

    const opponentName = await getUserDisplayName(opponentId);

    await sendNotification(
      fcmToken,
      {
        title: "📊 Score Updated",
        body: `${opponentName} has submitted their score. Check it out!`,
      },
      {
        type: "score_updated",
        challengeId: challengeData.challengeId || challengeData.id,
        opponentId: opponentId,
      }
    );
  } catch (error) {
    log.error("Error sending score updated notification", { error: error.message });
  }
};

module.exports = {
  sendChallengeCreatedNotification,
  sendChallengeAcceptedNotification,
  sendChallengeRejectedNotification,
  sendChallengeCompletedNotification,
  sendScoreUpdatedNotification,
  sendNotification,
};

