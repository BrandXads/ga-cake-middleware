const functions = require("firebase-functions");
const admin = require("firebase-admin");
const { GoogleAdsApi } = require("google-ads-api");
var serviceAccount = require("./example-firebase-adminsdk.json"); // This needs to be setup with your service account file
var moment = require("moment");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://g-ad-connector.firebaseio.com",
});

const client = new GoogleAdsApi({
  client_id: "###",
  client_secret: "###",
  developer_token: "###",
});

const customer = client.Customer({
  customer_account_id: "###-###-####",
  login_customer_id: "###-###-####",
  refresh_token: "###",
});

/**
 * Dev Endpoint for looking up ConversionAction Objects.
 */
exports.listConversionActions = functions.https.onRequest(
  (request, response) => {
    customer.conversionActions.list().then((result) => {
      return functions.logger.info(result);
    });

    response.send("logged");
  }
);

/**
 * Dev endpoint used for finding all conversion actions and their names
 */
exports.listCampaigns = functions.https.onRequest((request, response) => {
  customer.campaigns.list().then((results) => {
    return functions.logger.info("Campaign Name: ", results);
  });

  response.send("logged");
});

/**
 * Dev Endpoint to just make sure there's a testing campaign.
 */
exports.seedFirestore = functions.https.onRequest((request, response) => {
  admin
    .firestore()
    .collection("campaigns")
    .doc("9001")
    .set({ name: "customers/##########/conversionActions/##########" }); // Replace ##########

  response.send("logged");
});

/**
 * Dev Endpoint to just make sure there's a testing campaign.
 */
exports.logDate = functions.https.onRequest((request, response) => {
  admin
    .firestore()
    .collection("datelog")
    .doc()
    .set({
      date: moment(),
      momentFormat: moment().format("yyyy-MM-DD HH:mm:ssZ"),
      momentUtcFormat: moment().utc().format("yyyy-MM-DD HH:mm:ssZ"),
      url: request.protocol + "://" + request.get("host") + request.originalUrl,
    });

  response.send("logged");
});

/**
 * Takes a conversion object consiting of a detail, status, and meta object
 * User ConversionRequest to build a new Conversion from a request.
 */
class Conversion {
  constructor(conversion) {
    this.detail = conversion.detail;
    this.status = conversion.status;
    this.meta = conversion.meta;
  }

  async build() {
    // functions.logger.debug(this.detail);
    this.detail.conversion_action = await admin
      .firestore()
      .collection("campaigns")
      .doc(this.meta.campaignId)
      .get()
      .then((snap) => {
        if (snap.exists) {
          return snap.data().name;
        } else {
          functions.logger.error(
            "Unknown Campaign ID: " + this.meta.campaignId
          );
          return response.send("Unknown Campaign ID: " + this.meta.campaignId);
        }
      });
    this.store();
    return this;
  }

  updateStatus(status, message = "") {
    this.status.current = status;
    this.status.message = message;
    this.store();
    return this;
  }

  // returns: https://developers.google.com/google-ads/api/reference/rpc/v6/ClickConversion
  // TS Interface: node_modules\google-ads-node\build\lib\resources.d.ts:4439
  clickConversion() {
    return this.detail;
  }

  logAttempt() {
    this.status.lastAttempt = moment().format("yyyy-MM-DD HH:mm:ssZ");
    this.status.attempts += 1;
    this.store();
    return this;
  }

  async fire() {
    this.logAttempt();
    await this.build();
    const response = await customer.conversionUploads.uploadClickConversions(
      [this.clickConversion()],
      {
        // Testing mode switch, use false for production.
        validate_only: this.testMode,
        // Req by Google for this call | .catch() won't work, this endpoint will only quietly error via data object
        partial_failure: true,
      },
      // return array of uploaded conversions - Only works for development, if validate_only is false this will set to false
      this.testMode
    );

    this.parseConversionUpload(response);

    this.store();

    return this;
  }

  getConversion() {
    return {
      detail: this.detail,
      meta: this.meta,
      status: this.status,
    };
  }

  store() {
    admin
      .firestore()
      .collection("conversion")
      .doc(this.detail.gclid)
      .set(this.getConversion());
  }

  parseConversionUpload(res) {
    if (res[0].partial_failure_error) {
      this.updateStatus("error", res[0].partial_failure_error.message);
    } else {
      this.updateStatus(
        "success",
        `Conversion posted at ${moment().format("yyyy-MM-DD HH:mm:ssZ")}`
      );
    }

    this.response = res;

    return this;
  }
}

/**
 * designed to intake a request and output an extended instance of Conversion
 */
class ConversionRequest extends Conversion {
  constructor(request) {
    const status = {
      current: "new",
      message: "",
      attempts: 0,
      lastAttempt: null,
      testMode: false,
    };

    const detail = {
      gclid: request.query.gclid,
      conversion_date_time: moment().format("yyyy-MM-DD HH:mm:ssZ"),
      conversion_action: null,
    };

    if (request.query.oid !== undefined) {
      detail.order_id = request.query.oid;
    }
    // Append value if defined
    if (request.query.v !== undefined) {
      detail.conversion_value = request.query.v;
    }

    // Setup Meta Data
    const meta = {
      campaignId: request.query.cid,
      url:
        request.protocol +
        "://" +
        request.get("host") +
        "/uploadConversion" +
        request.originalUrl,
      date: moment().format("yyyy-MM-DD HH:mm:ssZ"),
      query: request.query,
    };

    super({ detail, status, meta });

    return this;
  }
}

/**
 * Main Webhook Endpoint
 *
 * This endpoint will accept:
 *
 * cid | Cake Campaign ID | Required
 * gclid | Google Click ID | Required
 * oid | Order / Transaction ID
 * v | Value of conversion
 */
exports.uploadConversion = functions.https.onRequest((request, response) => {
  const conversion = new ConversionRequest(request);

  conversion
    .fire()
    .then(() => {
      if (conversion.status.current === "error") {
        return response.send("error - request silently errored");
      } else {
        return response.send("success");
      }
    })
    .catch((error) => {
      conversion.updateStatus(
        "error",
        "the request failed to complete, see logs for details"
      );
      functions.logger.error("Function Failed!", error);
      return response.send("error - getConversionAction");
    });
});

exports.retryConversions = functions.https.onRequest((request, response) => {
  const ignoredErrors = [];
  let conversions = [];
  // Get all errored conversions from firestore -- indexable?
  const resultCollection = admin
    .firestore()
    .collection("conversion")
    .where("status.current", "==", "error")
    .where("status.attempts", "<", 5)
    .get()
    .then((results) => {
      results.forEach((result) => {
        const conversion = new Conversion(result.data());
        conversion.fire();
      });
      return response.send("success.");
    })
    .catch((err) => {
      functions.logger.error(err.message);
      return response.send("error.");
    });
});

exports.autoRetryConversions = functions.pubsub
  .schedule("every 6 hours")
  .onRun((context) => {
    // Get all errored conversions from firestore -- indexable?
    const resultCollection = admin
      .firestore()
      .collection("conversion")
      .where("status.current", "==", "error")
      .where("status.attempts", "<", 5)
      .get()
      .then((results) => {
        results.forEach((result) => {
          const conversion = new Conversion(result.data());
          conversion.fire();
        });
        return functions.logger.info(`processed ${results.length} conversions`);
      })
      .catch((err) => {
        return functions.logger.error(err.message);
      });
  });
