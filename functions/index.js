const functions = require("firebase-functions");
const admin = require("firebase-admin");
const utils = require("./utils");

admin.initializeApp();
const db = admin.firestore();

const fieldValue = admin.firestore.FieldValue;

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
