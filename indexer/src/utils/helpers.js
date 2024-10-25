export const decode = (byteArray) => {
    return new TextDecoder().decode(new Uint8Array(byteArray)).replaceAll(/\u0000/g, '');
  };

  export const removeQuotesFromStartAndEndOfString = (string) => {
    return string.substring(1, string.length - 1).substring(-1, string.length - 1);
  };

  export const stripHtmlIfNeeded = (object, value) => {
    let strippedDescription = striptags(object[value], [], ' ');
    strippedDescription = strippedDescription.replace('&nbsp;', ' ');
    if (strippedDescription !== object[value]) {
      object[value+"Html"] = object[value];
      object[value] = removeQuotesFromStartAndEndOfString(strippedDescription);
    }
  };