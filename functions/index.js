const functions = require("firebase-functions");
const admin = require("firebase-admin");
const utils = require("./utils");
const config = require("./config");
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

// exports.decrementBadgeOnNotificationRead = functions.firestore
//   .document("notifications/{notificationId}")
//   .onUpdate((change, context) => {
//     const newValue = change.after.data();

//     const previousValue = change.before.data();

//     if (newValue.read && !previousValue.read) {
//       var userBadgeRef = db.collection("users").doc(newValue.recipient);
//       userBadgeRef.update({ badgeCount: fieldValue.increment(-1) });
//     }
//   });
