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

  // console.log("sending", messages);
  const chunks = expo.chunkPushNotifications(messages);
  let tickets = [];
  (async () => {
    for (const chunk of chunks) {
      try {
        tickets.push(expo.sendPushNotificationsAsync(chunk));
      } catch (error) {
        console.error(error);
      }
    }
  })();

  return Promise.all(tickets).then((vals) => {
    var merged = [].concat.apply([], vals);

    console.log("ticket info:....", merged.length, merged);
    let receiptIds = [];
    for (let ticket of merged) {
      if (ticket.id) {
        receiptIds.push(ticket.id);
      } else {
        console.log("no ticket info", ticket);
      }
    }

    console.log("receiptIds", receiptIds);

    if (notificationId) {
      return db.collection("notificationResults").doc(notificationId).set({
        title: title,
        message: message,
        receiptIds: receiptIds,
        timeCreated: new Date(),
      });
    } else {
      return db.collection("notificationResults").add({
        title: title,
        message: message,
        receiptIds: receiptIds,
        timeCreated: new Date(),
      });
    }
  });
}

module.exports = {
  sendPushMessages: sendPushMessages,
};
