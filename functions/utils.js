const { Expo } = require("expo-server-sdk");

function sendPushMessages(title, message, badge, originalTokens, data) {
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

  return Promise.all(tickets);
}

module.exports = {
  sendPushMessages: sendPushMessages,
};
