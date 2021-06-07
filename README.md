# g-ad-connector

> This project is deployed on Firebase and is being used to relay covnersions from cake to Google Ads.

## Implementation

Universal Webhook: `https://us-central1-g-ad-connector.cloudfunctions.net/uploadConversion?cid=#campid#&oid=#leadid#&gclid=#s3#&v=#price#`

When the webhook is fired, the function will look for a relationship in the firebase collection `campaigns`, looking up a `campaign id` from cake and matching it to Googles `resource name` value which is needed to upload the converion to Google using the Google Ads API.

## Setup

- Place Universal Webhook in Cake
- Setup Conversion Action
- New Conversion Action > import > other data sources and CRMs > track conversion from click
- Standard Conversion Action Config

  ```
  Category: Purchase
  Name: Offer Name
  Value: Use different values for each conversion (set default value)
  Count: One
  Click-Through Window: 30 Days
  Include in Conversions: Yes
  Attribution Type: Last Click
  ```

- Use the Firebase `listConversionActions` fuction - It will output all Conversion Actions to functions.logger.
- Lookup the `resource name` in the functions.logger
- Input that `resource name` into Firebase and **MS Lists**
- Set Conv Sync Status" for the entry in **MS Lists** to "Setup Not Confirmed"
- Confirm the setup, place a test or wait for a sale - (Google may show delayed data - up to 24 hours)
- Once setup is confirmed update **MS List** Conv Sync Status to "Confirmed - Linked"

## Google API Notes

Google's API is meant to be consumed server side and oddly enough doesn't have a native NodeJS package. For this project I implemented the google-ads-api package. It's made by opteo, a company that sells a front end Google Ads manager and is likely the backbone of their product. The feature set is very complete but which the documentation is thorough it ins't perfect, things like variables listed as optional in the documentation actually being required.
