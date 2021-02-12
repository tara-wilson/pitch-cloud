import * as admin from "firebase-admin";
import * as functions from "firebase-functions";
import Stripe from "stripe";
import {
  Product,
  Price,
  Subscription,
  CustomerData,
  TaxRate,
} from "./interfaces";
import * as logs from "./logs";

/**
 * Create a CheckoutSession for the customer so they can sign up for the subscription.
 */
// exports.createCheckoutSession = functions.firestore
//   .document(`/${config.customersCollectionPath}/{uid}/checkout_sessions/{id}`)
//   .onCreate(async (snap, context) => {
//     const {
//       price,
//       success_url,
//       cancel_url,
//       quantity = 1,
//       payment_method_types = ['card'],
//       metadata = {},
//       tax_rates = [],
//       allow_promotion_codes = false,
//       trial_from_plan = true,
//       line_items,
//       billing_address_collection = 'required',
//       locale = 'auto',
//       promotion_code,
//     } = snap.data();
//     try {
//       logs.creatingCheckoutSession(context.params.id);
//       // Get stripe customer id
//       let customerRecord = (await snap.ref.parent.parent.get()).data();
//       if (!customerRecord?.stripeId) {
//         const { email } = await admin.auth().getUser(context.params.uid);
//         customerRecord = await createCustomerRecord({
//           uid: context.params.uid,
//           email,
//         });
//       }
//       const customer = customerRecord.stripeId;
//       const sessionCreateParams = {
//         billing_address_collection,
//         payment_method_types,
//         customer,
//         line_items: line_items
//           ? line_items
//           : [
//               {
//                 price,
//                 quantity,
//                 tax_rates,
//               },
//             ],
//         mode: 'subscription',
//         subscription_data: {
//           trial_from_plan,
//           metadata,
//         },
//         success_url,
//         cancel_url,
//         locale,
//       };
//       if (promotion_code) {
//         sessionCreateParams.discounts = [{ promotion_code }];
//       } else {
//         sessionCreateParams.allow_promotion_codes = allow_promotion_codes;
//       }
//       const session = await stripe.checkout.sessions.create(
//         sessionCreateParams,
//         { idempotencyKey: context.params.id }
//       );
//       await snap.ref.set(
//         {
//           sessionId: session.id,
//           created: admin.firestore.Timestamp.now(),
//         },
//         { merge: true }
//       );
//       logs.checkoutSessionCreated(context.params.id);
//       return;
//     } catch (error) {
//       logs.checkoutSessionCreationError(context.params.id, error);
//       await snap.ref.set(
//         { error: { message: error.message } },
//         { merge: true }
//       );
//     }
//   });

// /**
//  * Insert tax rates into the products collection in Cloud Firestore.
//  */
// const insertTaxRateRecord = async (taxRate: Stripe.TaxRate): Promise<void> => {
//   const taxRateData: TaxRate = {
//     ...taxRate,
//     ...prefixMetadata(taxRate.metadata),
//   };
//   delete taxRateData.metadata;
//   await admin
//     .firestore()
//     .collection(config.productsCollectionPath)
//     .doc('tax_rates')
//     .collection('tax_rates')
//     .doc(taxRate.id)
//     .set(taxRateData);
//   logs.firestoreDocCreated('tax_rates', taxRate.id);
// };
