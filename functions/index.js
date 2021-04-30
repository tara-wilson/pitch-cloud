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

    return getUserForId("FvJMey7h22ZlPAT85EcE1askMYO2").then((tara) => {
      return getUserForId("a6eLSHlmYnXd2CDg1sgje4m0FpV2").then((blair) => {
        return getUserForId("pkjdxzebpTMmVKbziZ6UloBtK7m1").then((emma) => {
          utils.sendPushMessages(
            "Pitch",
            "New Booking!",
            null,
            [tara.pushToken, blair.pushToken, emma.pushToken],
            {}
          );

          return sendEmail(
            {
              recipientEmail: data.recipientEmail,
              scoutName: "",
              recipientName: data.recipientName,
              destinationTitle: data.siteName,
              startDate: data.startDate,
              campsiteName: "",
              endDate: data.endDate,
              bookingId: bookingId,
              price: data.payment ? data.payment.amount / 100 : "",
              campsiteNumber: data.campsiteNumber ? data.campsiteNumber : "",
            },
            { emailTemplateId: "3d3b7559-6737-4dc4-9e0f-ddbbbc9a28c0" }
          );
        });
      });
    });
  });

exports.notifyOnContactCreate = functions.firestore
  .document("contacts/{contactId}")
  .onCreate((snap, context) => {
    const data = snap.data();

    return getUserForId("FvJMey7h22ZlPAT85EcE1askMYO2").then((tara) => {
      return getUserForId("a6eLSHlmYnXd2CDg1sgje4m0FpV2").then((blair) => {
        return getUserForId("pkjdxzebpTMmVKbziZ6UloBtK7m1").then((emma) => {
          utils.sendPushMessages(
            "Pitch",
            data.email
              ? `There is a new App Message from ${data.email} in the Admin Portal`
              : "There is a new App Message in the Admin Portal",
            null,
            [tara.pushToken, blair.pushToken, emma.pushToken],
            {}
          );
        });
      });
    });
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
          if (tmp.chatMessage && tmp.chatMessages.length > 0) {
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

exports.sendMessageNow = functions.https.onRequest((req, res) => {
  const id = req.query.id;
  let templates = {};
  getTemplates().then((ts) => {
    templates = ts;

    getMessageItemForId(id).then((item) => {
      let promises = [];

      let tmp = templates[item.messageTemplate];
      if (tmp.pushNotification) {
        promises.push(handleMessagePushNotification(item, tmp));
      }
      if (tmp.chatMessage && tmp.chatMessages.length > 0) {
        promises.push(handleMessageChatUpdates(item, tmp));
      }
      if (tmp.email && tmp.emailTemplateId) {
        promises.push(handleMessageEmail(item, tmp));
      }
      promises.push(
        db.doc(`scheduledMessages/${item.id}`).update({ sent: true })
      );

      Promise.all(promises).then((result) => {
        res.send({ res: result });
      });
    });
  });
});

exports.createScout = functions.https.onRequest((req, res) => {
  const userId = req.query.id;
  return getUserForId(userId).then((user) => {
    let newScout = {
      bio: "",
      aboutQuestions: [],
      destinations: "",
      email: user.email,
      firstName: user.firstName ? user.firstName : "",
      lastName: user.lastName ? user.lastName : "",
      userId: userId,
    };
    return db
      .collection("scouts")
      .add(newScout)
      .then((scoutRes) => {
        let scoutId = scoutRes.id;
        return db
          .collection("users")
          .doc(userId)
          .update({ scout: true, scoutId: scoutId })
          .then((upd) => {
            return res.redirect(
              `https://pitch-admin-portal.herokuapp.com/#/scouts/${scoutId}/show`
            );
          });
      });
  });
});

exports.cancellation = functions.https.onCall((data, context) => {
  let cancellationTemplate = "b27ccb4f-8170-4bc9-b509-ae36b7e29bf1";
  const bookingId = data.id;

  getBooking({ bookingId: bookingId }).then((booking) => {
    if (booking.scoutId) {
      return getScoutForId(booking.scoutId).then((scoutObj) => {
        return getUserForId(scoutObj.userId).then((scoutUser) => {
          utils.sendPushMessages(
            "Pitch",
            `The booking on ${moment(
              new Date(booking.startDate.seconds * 1000)
            ).format("MMMM Do")} to ${booking.siteName} was cancelled.`,
            null,
            [scoutUser.pushToken],
            {}
          );
          return sendEmail(
            {
              recipientEmail: booking.recipientEmail,
              scoutName: booking.scoutName ? booking.scoutName : "",
              recipientName: booking.recipientName,
              destinationTitle: booking.siteName,
              startDate: booking.startDate,
              campsiteName: booking.campsiteName ? booking.campsiteName : "",
              endDate: booking.endDate,
              bookingId: bookingId,
              price: booking.payment ? booking.payment.amount / 100 : "",
              campsiteNumber: booking.campsiteNumber
                ? booking.campsiteNumber
                : "",
            },
            { emailTemplateId: cancellationTemplate }
          ).then(() => {
            return getScheduledForBooking(bookingId).then(
              (scheduledMessages) => {
                var batch = db.batch();

                scheduledMessages.forEach(async (event) => {
                  var eventRef = db
                    .collection("scheduledMessages")
                    .doc(event.id);
                  batch.delete(eventRef);
                });

                return batch.commit();
              }
            );
          });
        });
      });
    } else {
      return sendEmail(
        {
          recipientEmail: booking.recipientEmail,
          scoutName: booking.scoutName ? booking.scoutName : "",
          recipientName: booking.recipientName,
          destinationTitle: booking.siteName,
          startDate: booking.startDate,
          campsiteName: booking.campsiteName ? booking.campsiteName : "",
          endDate: booking.endDate,
          bookingId: bookingId,
          price: booking.payment ? booking.payment.amount / 100 : "",
          campsiteNumber: booking.campsiteNumber ? booking.campsiteNumber : "",
        },
        { emailTemplateId: cancellationTemplate }
      ).then(() => {
        return getScheduledForBooking(bookingId).then((scheduledMessages) => {
          var batch = db.batch();

          scheduledMessages.forEach(async (event) => {
            var eventRef = db.collection("scheduledMessages").doc(event.id);
            batch.delete(eventRef);
          });

          return batch.commit();
        });
      });
    }
  });
});

exports.manualCheckSend = functions.https.onRequest((req, res) => {
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
        if (tmp.chatMessage && tmp.chatMessages.length > 0) {
          promises.push(handleMessageChatUpdates(item, tmp));
        }
        if (tmp.email && tmp.emailTemplateId) {
          promises.push(handleMessageEmail(item, tmp));
        }
        promises.push(
          db.doc(`scheduledMessages/${item.id}`).update({ sent: true })
        );
      });

      return Promise.all(promises).then(() => {
        res.send({ data: sc });
      });
    });
  });
});

const handleMessageChatUpdates = async (message, template) => {
  return getBooking(message).then((booking) => {
    if (!booking.cancelled) {
      let messages = [...booking.messages];
      let id = messages.length;
      template.chatMessages.forEach((cm) => {
        messages.push({
          id: `${id}`,
          date: new Date(),
          recipient: booking.userId,
          sender: booking.scoutId ? booking.scoutId : null,
          text: updateMessageString(cm.text, message, booking),
          user: {
            _id: booking.scoutId ? booking.scoutId : null,
          },
        });
        id++;
      });

      return db
        .collection("bookings")
        .doc(message.bookingId)
        .update({
          messages: messages,
          unread: (booking.unread || 0) + messages.length,
        })
        .then(() => ({
          booking: booking,
          template: template,
          message: message,
        }));
    } else {
      return {};
    }
  });
};

const handleMessagePushNotification = async (message, template) => {
  return getBooking(message).then((booking) => {
    if (!booking.cancelled) {
      return getRecipient(message).then((user) => {
        let title = "Pitch";
        let oldCount = user.badgeCount || 0;

        var userBadgeRef = db.collection("users").doc(message.recipient);
        userBadgeRef.update({ badgeCount: oldCount + 1 });

        utils.sendPushMessages(
          title,
          updateMessageString(template.subject, message, booking),
          oldCount + 1,
          [user.pushToken],
          message
        );

        return { user: user, message: message, template: template };
      });
    } else {
      return {};
    }
  });
};

const handleMessageEmail = async (message, template) => {
  return getBooking(message).then((booking) => {
    if (!booking.cancelled) {
      return sendEmail(
        {
          ...message,
          scoutName: booking.scoutName || "",
          campsiteName: booking.campsiteName || "",
          price: booking.payment ? booking.payment.amount / 100 : "",
          campsiteNumber: booking.campsiteNumber ? booking.campsiteNumber : "",
        },
        template
      );
    } else {
      return {};
    }
  });
};

const sendEmail = async (message, template) => {
  let url = `https://api.createsend.com/api/v3.2/transactional/smartemail/${template.emailTemplateId}/send?clientID=b649a7d2b2db56612f25541b6d532216`;
  let requestBody = {
    To: [message.recipientEmail],
    Data: {
      scout_name: message.scoutName,
      recipient_name: message.recipientName,
      campsite_title: message.campsiteName,
      destination_title: message.destinationTitle,
      start_date: moment(new Date(message.startDate.seconds * 1000)).format(
        "MMMM Do YYYY"
      ),
      end_date: moment(new Date(message.endDate.seconds * 1000)).format(
        "MMMM Do YYYY"
      ),
      conf_code: message.bookingId.slice(0, 5),
      price: message.price,
      campsite_number: message.campsiteNumber,
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

const updateMessageString = (subject, message, booking) => {
  let sub = `${subject}`;
  let startDate = moment(new Date(message.startDate.seconds * 1000)).format(
    "MMMM Do YYYY"
  );
  let endDate = moment(new Date(message.endDate.seconds * 1000)).format(
    "MMMM Do YYYY"
  );
  sub = sub.replace("[destination_title]", message.destinationTitle);

  sub = sub.replace("[scout_name]", booking.scoutName);
  sub = sub.replace("[recipient_name]", message.recipientName);
  sub = sub.replace("[campsite_title]", booking.campsiteName);
  sub = sub.replace("[campsite_number]", booking.campsiteNumber);
  sub = sub.replace(
    "[price]",
    booking.payment && booking.payment.amount
      ? booking.payment.amount / 100
      : ""
  );
  sub = sub.replace("[conf_code]", message.bookingId.slice(0, 5));
  sub = sub.replace("[start_date]", startDate);
  sub = sub.replace("[end_date]", endDate);

  return sub;
};

const getMessageItemForId = async (id) => {
  return db
    .collection("scheduledMessages")
    .doc(id)
    .get()
    .then((snapshot) => {
      return { ...snapshot.data(), id: id };
    });
};

const getUserForId = async (id) => {
  return db
    .collection("users")
    .doc(id)
    .get()
    .then((item) => {
      return { ...item.data(), id: item.id };
    });
};

const getScoutForId = async (id) => {
  return db
    .collection("scouts")
    .doc(id)
    .get()
    .then((item) => {
      return { ...item.data(), id: item.id };
    });
};

const getCurrentScheduled = async () => {
  let now = moment().tz("America/New_York").toDate();
  let hour = moment().tz("America/New_York").hour();
  let users = [];
  let items = [];
  return db
    .collection("scheduledMessages")
    .where("scheduledDate", "<=", now)
    .where("sent", "==", false)
    .get()
    .then((snapshot) => {
      snapshot.forEach((doc) => {
        let msg = { ...doc.data(), id: doc.id };
        if (users.includes(msg.recipient)) {
          console.log("already has", msg.recipient);
        } else {
          items.push(msg);
          users.push(msg.recipient);
        }
      });
      return items.filter((it) => !it.sent && it.scheduledHour <= hour);
    });
};

const getScheduledForBooking = async (bookingId) => {
  return db
    .collection("scheduledMessages")
    .where("bookingId", "==", bookingId)
    .get()
    .then((snapshot) => {
      let items = [];
      snapshot.forEach((doc) => {
        items.push({ ...doc.data(), id: doc.id });
      });
      return items;
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

exports.onDeleteBooking = functions.firestore
  .document("bookings/{bookingId}")
  .onDelete((snap, context) => {
    const bookingId = context.params.bookingId;

    return getScheduledForBooking(bookingId).then((scheduledMessages) => {
      var batch = db.batch();

      scheduledMessages.forEach(async (event) => {
        var eventRef = db.collection("scheduledMessages").doc(event.id);
        batch.delete(eventRef);
      });

      return batch.commit();
    });
  });

// exports.moveCustomersToProd = functions.https.onRequest((req, res) => {
//   return db
//     .collection("users")

//     .get()
//     .then((snapshot) => {
//       let items = [];
//       snapshot.forEach((doc) => {
//         items.push({ ...doc.data(), id: doc.id });
//       });

//       let promises = [];

//       items.forEach(async (user) => {
//         promises.push(
//           createCustomerRecord({ email: user.email, uid: user.id })
//         );
//       });

//       return Promise.all(promises).then((f) => {
//         res.send({ items: items, results: f });
//       });
//     });
// });
