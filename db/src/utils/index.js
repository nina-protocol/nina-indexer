import striptags from 'striptags';
import { TwitterApi } from 'twitter-api-v2';
import Account from '../models/Account.js';

const TWEET_DELAY = 360000; // 6 minutes
const NINA_DOMAIN = 'https://ninaprotocol.com';
const removeQuotesFromStartAndEndOfString = (string) => {
  return string.substring(1, string.length - 1).substring(-1, string.length - 1);
}

export const stripHtmlIfNeeded = (object, value) => {
  let strippedDescription = striptags(object[value], [], ' ');
  strippedDescription = strippedDescription.replace('&nbsp;', ' ');
  if (strippedDescription !== object[value]) {
    object[value+"Html"] = object[value];
    object[value] = removeQuotesFromStartAndEndOfString(strippedDescription);
  }
}

export const decode = (byteArray) => {
  return new TextDecoder().decode(new Uint8Array(byteArray)).replaceAll(/\u0000/g, '');
}

export const tweetNewRelease = async (metadata, publisherId, slug) => {
  if (process.env.TWITTER_API_SECRET) {
    try {
      await new Promise(resolve => setTimeout(resolve, TWEET_DELAY))
      const client = new TwitterApi({
        appKey: process.env.TWITTER_API_KEY,
        appSecret: process.env.TWITTER_API_SECRET,
        accessToken: process.env.TWITTER_ACCESS_TOKEN,
        accessSecret: process.env.TWITTER_ACCESS_TOKEN_SECRET,
      });
      let text = (`${metadata.properties.artist ? `${metadata.properties.artist} - ` : ''}${metadata.properties.title}`).substr(0, 250)
      const publisher = await Account.query().findById(publisherId);
      if (publisher) {
        const twitterVerification = (await publisher.$relatedQuery('verifications').where('type', 'twitter').andWhere('active', true))[0]
        if (twitterVerification) {
          text = `${text} (@${twitterVerification.value})`
        }
      }
      text = `${text} ${NINA_DOMAIN}/releases/${slug}`
      await client.v2.tweet(text);  
    } catch (error) {
      console.warn('error sending new release tweet: ', error, metadata)
    }
  }
}