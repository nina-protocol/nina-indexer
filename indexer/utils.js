const striptags = require('striptags');

const decode = (byteArray) => {
  return new TextDecoder().decode(new Uint8Array(byteArray)).replaceAll(/\u0000/g, '');
}

const removeQuotesFromStartAndEndOfString = (string) => {
  return string.substring(1, string.length - 1).substring(-1, string.length - 1);
}

const stripHtmlIfNeeded = (object, value) => {
  const strippedDescription = striptags(object[value], [], " ");
  if (strippedDescription !== object[value]) {
    object[value+"Html"] = object[value];
    object[value] = removeQuotesFromStartAndEndOfString(strippedDescription);
  }
}

module.exports = {
  decode,
  stripHtmlIfNeeded,
}