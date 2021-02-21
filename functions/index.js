const functions = require("firebase-functions");
const admin = require("firebase-admin");
const utils = require("./utils");
const config = require("./config");
const moment = require("moment-timezone");
const Stripe = require("stripe");
const stripe = new Stripe(config.stripeSecretKey, {
  apiVersion: "2020-08-27",
});
var request = require("request");

const MAIL_KEY =
  "EcwE3FTl+C9kWXdGlSg9HK3sqw6SFQs7AFA4mM/hCNEqvqCJGJmc8L5HLgFXH02Uh7Y9mDx7v3+Ml7DjM8NUIK5sKgv9NjsI6l2WCRViZAyNl2GtcMBn/hKmM8Nu3B11JwHKUxIeIjcK//P9IFc9VQ==";

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

exports.emailOnNotificationCreate = functions.firestore
  .document("notifications/{notificationId}")
  .onCreate((snap, context) => {
    const notificationId = context.params.notificationId;
    const data = snap.data();

    if (!data.sentViaEmail && !data.toScout) {
      db.doc(`notifications/${notificationId}`).update({ sentViaEmail: true });
      return sendChatAsEmail(data.senderName, data.recipientEmail, data.text);
    }
  });

exports.emailOnBookingCreate = functions.firestore
  .document("bookings/{bookingId}")
  .onCreate((snap, context) => {
    const bookingId = context.params.bookingId;
    const data = snap.data();

    return handleMessageEmail(
      {
        recipientEmail: data.recipientEmail,
        scoutName: data.scoutName,
        recipientName: data.recipientName,
        destinationTitle: data.siteName,
        startDate: data.startDate,
        campsiteName: data.campsiteName,
        endDate: data.endDate,
        bookingId: bookingId,
      },
      { emailTemplateId: "3d3b7559-6737-4dc4-9e0f-ddbbbc9a28c0" }
    );
  });

exports.checkForScheduledMessages = functions.pubsub
  .schedule("10 8-20 * * *")
  .timeZone("America/New_York")
  .onRun((context) => {
    let templates = {};
    return getTemplates().then((ts) => {
      templates = ts;

      return getCurrentScheduled().then((sc) => {
        let promises = [];

        sc.forEach((item) => {
          let tmp = templates[item.messageTemplate];
          if (tmp.pushNotification) {
            promises.push(handleMessagePushNotification(item, tmp));
          }
          if (
            item.bookingId &&
            tmp.chatMessage &&
            tmp.chatMessages.length > 0
          ) {
            promises.push(handleMessageChatUpdates(item, tmp));
          }
          if (tmp.email && tmp.emailTemplateId) {
            promises.push(handleMessageEmail(item, tmp));
          }
          promises.push(
            db.doc(`scheduledMessages/${item.id}`).update({ sent: true })
          );
        });

        return Promise.all(promises);
      });
    });
  });

exports.subscribeOnUserCreate = functions.firestore
  .document("users/{userId}")
  .onCreate((snap, context) => {
    const data = snap.data();

    return subscribeToList(data.email, `${data.firstName} ${data.lastName}`);
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
        if (tmp.email && tmp.emailTemplateId) {
          promises.push(handleMessageEmail(item, tmp));
        }
        promises.push(
          db.doc(`scheduledMessages/${item.id}`).update({ sent: true })
        );
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

const handleMessageEmail = async (message, template) => {
  let url = `https://api.createsend.com/api/v3.2/transactional/smartemail/${template.emailTemplateId}/send?clientID=b649a7d2b2db56612f25541b6d532216`;
  let requestBody = {
    To: [message.recipientEmail],
    Data: {
      scout_name: message.scoutName,
      recipient_name: message.recipientName,
      campsite_name: message.campsiteName,
      destination_title: message.destinationTitle,
      start_date: moment(new Date(message.startDate.seconds * 1000)).format(
        "MMMM Do YYYY"
      ),
      end_date: moment(new Date(message.endDate.seconds * 1000)).format(
        "MMMM Do YYYY"
      ),
      conf_code: message.bookingId.slice(0, 5),
    },

    ConsentToTrack: "Yes",
  };

  var options = {
    url: url,
    method: "POST",
    auth: {
      user: MAIL_KEY,
      password: "x",
    },
    body: JSON.stringify(requestBody),
  };

  return request(options, function (err, resp, body) {
    if (err) {
      console.log(err);
      return;
    }
    return resp;
  });
};

const sendChatAsEmail = async (scoutName, recipientEmail, text) => {
  let url = `https://api.createsend.com/api/v3.2/transactional/smartemail/d7b08187-03ad-466f-b8d8-31c28641fe6a/send?clientID=b649a7d2b2db56612f25541b6d532216`;
  let requestBody = {
    To: [recipientEmail],
    Data: {
      scout_name: scoutName,
      chat_text: text,
    },

    ConsentToTrack: "Yes",
  };

  var options = {
    url: url,
    method: "POST",
    auth: {
      user: MAIL_KEY,
      password: "x",
    },
    body: JSON.stringify(requestBody),
  };

  return new Promise((resolve, reject) => {
    request(options, function (err, resp, body) {
      if (err) {
        console.log(err);
        resolve(err);
      }

      resolve(body);
    });
  });
};

const subscribeToList = async (email, name) => {
  let url = `https://api.createsend.com/api/v3.2/subscribers/ce73da593a2b1ceef2b7ade442dc9263.json?clientID=b649a7d2b2db56612f25541b6d532216`;

  let requestBody = {
    EmailAddress: `${email}`,
    Name: name,
    ConsentToTrack: "Yes",
  };

  console.log("req", requestBody);

  var options = {
    url: url,
    method: "POST",
    auth: {
      user: MAIL_KEY,
      password: "x",
    },
    body: JSON.stringify(requestBody),
  };

  return new Promise((resolve, reject) => {
    request(options, function (err, resp, body) {
      if (err) {
        console.log(err);
        resolve(err);
      }

      resolve({ body: body, err: err });
    });
  });
};

const updateMessageString = (subject, message) => {
  let sub = `${subject}`;
  let startDate = moment(new Date(message.startDate.seconds * 1000)).format(
    "MMMM Do YYYY"
  );
  let endDate = moment(new Date(message.endDate.seconds * 1000)).format(
    "MMMM Do YYYY"
  );
  sub = sub.replace("[destination_title]", message.destinationTitle);

  sub = sub.replace("[scout_name]", message.scoutName);
  sub = sub.replace("[recipient_name]", message.recipientName);
  sub = sub.replace("[campsite_name]", message.campsiteName);
  sub = sub.replace("[conf_code]", message.bookingId.slice(0, 5));
  sub = sub.replace("[start_date]", startDate);
  sub = sub.replace("[end_date]", endDate);

  return sub;
};

const getCurrentScheduled = async () => {
  let now = moment().tz("America/New_York").toDate();
  let hour = moment().tz("America/New_York").hour();
  return db
    .collection("scheduledMessages")
    .where("scheduledDate", "<=", now)
    .where("scheduledHour", "<=", hour)
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
