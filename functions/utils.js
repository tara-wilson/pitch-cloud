const { Expo } = require("expo-server-sdk");
const admin = require("firebase-admin");

function sendPushMessages(
  title,
  message,
  badge,
  originalTokens,
  data,
  notificationId
) {
  const db = admin.firestore();
  const expo = new Expo();
  const tokens = originalTokens.filter((token) => Expo.isExpoPushToken(token));
  const messages = [];
  tokens.forEach((token) => {
    if (badge) {
      messages.push({
        to: token,
        sound: "default",
        title: title,
        body: message,
        badge: badge,
        data: data,
      });
    } else {
      messages.push({
        to: token,
        sound: "default",
        title: title,
        body: message,
        data: data,
      });
    }
  });

  console.log("sending", messages);
  const chunks = expo.chunkPushNotifications(messages);
  const tickets = [];
  (async () => {
    for (const chunk of chunks) {
      try {
        const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
        tickets.push(...ticketChunk);
      } catch (error) {
        console.error(error);
      }
    }
  })();

  return Promise.all(tickets).then((responses) => {
    if (notificationId) {
      return db.collection("notificationResults").doc(notificationId).set({
        title: title,
        message: message,
        tickets: tickets,
        timeCreated: new Date(),
      });
    } else {
      return db.collection("notificationResults").add({
        title: title,
        message: message,
        tickets: tickets,
        timeCreated: new Date(),
      });
    }
  });
}

module.exports = {
  sendPushMessages: sendPushMessages,
};
