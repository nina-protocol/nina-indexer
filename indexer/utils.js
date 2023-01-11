const { TwitterApi } = require('twitter-api-v2');

const sleep = (length) => new Promise(resolve => setTimeout(resolve, length))

const decode = (byteArray) => {
  return new TextDecoder().decode(new Uint8Array(byteArray)).replaceAll(/\u0000/g, '');
}
module.exports = {
  decode,
}