const functions = require("firebase-functions");
const admin = require("firebase-admin");
const utils = require("./utils");
const config = require("./config");
const moment = require("moment-timezone");
const Stripe = require("stripe");
const stripe = new Stripe(config.stripeSecretKey, {
  apiVersion: "2020-08-27",
});

admin.initializeApp();
const db = admin.firestore();

exports.createCustomer = functions.auth.user().onCreate(async (user) => {
  if (!config.syncUsersOnCreate) return;
  const { email, uid } = user;
  await createCustomerRecord({ email, uid });
});

const createCustomerRecord = async ({ email, uid }) => {
  try {
    const customerData = {
      metadata: {
        firebaseUID: uid,
      },
    };
    if (email) customerData.email = email;
    const customer = await stripe.customers.create(customerData);
    // Add a mapping record in Cloud Firestore.
    const customerRecord = {
      stripeId: customer.id,
      stripeLink: `https://dashboard.stripe.com${
        customer.livemode ? "" : "/test"
      }/customers/${customer.id}`,
    };
    await admin
      .firestore()
      .collection(config.customersCollectionPath)
      .doc(uid)
      .set(customerRecord, { merge: true });
    return customerRecord;
  } catch (error) {
    return null;
  }
};

exports.notifyOnNotificationCreate = functions.firestore
  .document("notifications/{notificationId}")
  .onCreate((snap, context) => {
    const notificationId = context.params.notificationId;
    const data = snap.data();

    if (!data.notified) {
      db.doc(`notifications/${notificationId}`).update({ notified: true });

      db.collection("users")
        .doc(data.recipient)
        .get()
        .then((item) => {
          let user = item.data();
          let oldCount = user.badgeCount || 0;

          if (!data.read) {
            var userBadgeRef = db.collection("users").doc(data.recipient);
            userBadgeRef.update({ badgeCount: oldCount + 1 });
          }

          let title = data.asChatMessage ? data.senderName : "Pitch";
          utils.sendPushMessages(
            title,
            data.text,
            oldCount + 1,
            [data.recipientPushToken],
            data
          );
        });
    }
  });

exports.manualCheckSend = functions.https.onRequest((req, res) => {
  let templates = {};
  getTemplates().then((ts) => {
    templates = ts;

    getCurrentScheduled().then((sc) => {
      let promises = [];

      sc.forEach((item) => {
        let tmp = templates[item.messageTemplate];
        if (tmp.pushNotification) {
          promises.push(handleMessagePushNotification(item, tmp));
        }
        if (item.bookingId && tmp.chatMessage && tmp.chatMessages.length > 0) {
          promises.push(handleMessageChatUpdates(item, tmp));
        }
      });

      Promise.all(promises).then((result) => {
        res.send({ res: result });
      });
    });
  });
});

const handleMessageChatUpdates = async (message, template) => {
  return getBooking(message).then((booking) => {
    let messages = [...booking.messages];
    let id = messages.length;
    template.chatMessages.forEach((cm) => {
      messages.push({
        id: `${id}`,
        date: new Date(),
        recipient: booking.userId,
        sender: booking.scoutId ? booking.scoutId : null,
        text: updateMessageString(cm.text, message),
        user: {
          _id: booking.scoutId ? booking.scoutId : null,
        },
      });
      id++;
    });

    return db
      .collection("bookings")
      .doc(message.bookingId)
      .update({ messages: messages })
      .then(() => ({ booking: booking, template: template, message: message }));
  });
};

const getRecipient = async (message) => {
  return db
    .collection("users")
    .doc(message.recipient)
    .get()
    .then((item) => {
      return { ...item.data(), id: item.id };
    });
};

const getBooking = async (message) => {
  return db
    .collection("bookings")
    .doc(message.bookingId)
    .get()
    .then((item) => {
      return { ...item.data(), id: item.id };
    });
};

const updateMessageString = (subject, message) => {
  let sub = `${subject}`;
  sub = sub.replace("${destination}", message.destinationTitle);
  return sub;
};

const handleMessagePushNotification = async (message, template) => {
  return getRecipient(message).then((user) => {
    let title = "Pitch";
    let oldCount = user.badgeCount || 0;

    var userBadgeRef = db.collection("users").doc(message.recipient);
    userBadgeRef.update({ badgeCount: oldCount + 1 });

    utils.sendPushMessages(
      title,
      updateMessageString(template.subject, message),
      oldCount + 1,
      [user.pushToken],
      message
    );

    return { user: user, message: message, template: template };
  });
};
const getCurrentScheduled = async () => {
  let now = moment().tz("America/New_York").toDate();
  let hour = moment().tz("America/New_York").hour();
  return db
    .collection("scheduledMessages")
    .where("scheduledDate", "<", now)
    .where("scheduledHour", "==", hour)
    .get()
    .then((snapshot) => {
      let items = [];
      snapshot.forEach((doc) => {
        items.push({ ...doc.data(), id: doc.id });
      });
      return items.filter((it) => !it.sent);
    });
};

const getTemplates = async () => {
  return db
    .collection("messageTemplates")
    .get()
    .then((snapshot) => {
      let items = {};
      snapshot.forEach((doc) => {
        items[doc.id] = { ...doc.data(), id: doc.id };
      });
      return items;
    });
};
