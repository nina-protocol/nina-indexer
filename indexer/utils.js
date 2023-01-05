const { TwitterApi } = require('twitter-api-v2');

const striptags = require('striptags');

const sleep = (length) => new Promise(resolve => setTimeout(resolve, length))

const decode = (byteArray) => {
  return new TextDecoder().decode(new Uint8Array(byteArray)).replaceAll(/\u0000/g, '');
}

const removeQuotesFromStartAndEndOfString = (string) => {
  return string.substring(1, string.length - 1).substring(-1, string.length - 1);
}

const stripHtmlIfNeeded = (object, value) => {
  let strippedDescription = striptags(object[value], [], ' ');
  strippedDescription = strippedDescription.replace('&nbsp;', ' ');
  if (strippedDescription !== object[value]) {
    object[value+"Html"] = object[value];
    object[value] = removeQuotesFromStartAndEndOfString(strippedDescription);
  }
}

const tweetNewRelease = async (metadata) => {
  if (process.env.TWITTER_API_SECRET) {
    try {
      await sleep(60000)
      const client = new TwitterApi({
        appKey: process.env.TWITTER_API_KEY,
        appSecret: process.env.TWITTER_API_SECRET,
        accessToken: process.env.TWITTER_ACCESS_TOKEN,
        accessSecret: process.env.TWITTER_ACCESS_TOKEN_SECRET,
      });
  
      let text = (`${metadata.properties.artist} - "${metadata.properties.title}"`).substr(0, 250)
      text = `${text} ${metadata.external_url}`
      await client.v2.tweet(text);  
    } catch (error) {
      console.warn('error sending new release tweet: ', error, metadata)
    }
  }
}

module.exports = {
  decode,
  stripHtmlIfNeeded,
  tweetNewRelease
}