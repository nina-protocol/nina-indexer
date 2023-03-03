import striptags from 'striptags';
import { TwitterApi } from 'twitter-api-v2';

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

export const tweetNewRelease = async (metadata, publisher) => {
  if (process.env.TWITTER_API_SECRET) {
    try {
      let text = (`${metadata.properties.artist} - "${metadata.properties.title}"`).substr(0, 225)
      const twitterVerification = (await publisher.$relatedQuery('verifications').where('type', 'twitter').where('active', true))[0]
      if (twitterVerification) {
        text = `${text} (@${twitterVerification.value})`
      }
      text = `${text} ${metadata.external_url}`

      await new Promise(resolve => setTimeout(resolve, 60000))
      const client = new TwitterApi({
        appKey: process.env.TWITTER_API_KEY,
        appSecret: process.env.TWITTER_API_SECRET,
        accessToken: process.env.TWITTER_ACCESS_TOKEN,
        accessSecret: process.env.TWITTER_ACCESS_TOKEN_SECRET,
      });
  
      await client.v2.tweet(text);  
    } catch (error) {
      console.warn('error sending new release tweet: ', error, metadata)
    }
  }
}