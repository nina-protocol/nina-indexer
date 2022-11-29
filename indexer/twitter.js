import TwitterApi from 'twitter-api-v2';

const sleep = (duration) => new Promise(resolve => setTimeout(resolve, duration))

export const tweetNewRelease = async(metadata) => {
  try {
    if (
      process.env.SHOULD_TWEET_NEW_RELEASES === 'true' &&
      process.env.TWITTER_API_KEY &&
      process.env.TWITTER_API_SECRET_KEY &&
      process.env.TWITTER_ACCESS_TOKEN &&
      process.env.TWITTER_ACCESS_TOKEN_SECRET
    ) {
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
    }
  } catch (error) {
    console.warn('error sending new release tweet: ', error, metadata)
  }
}
