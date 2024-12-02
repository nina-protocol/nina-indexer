import axios from "axios";

export const decode = (byteArray) => {
  return new TextDecoder().decode(new Uint8Array(byteArray)).replaceAll(/\u0000/g, '');
};

export const fetchFromArweave = async (uri) => {
  let response;
  try {
    response = await axios.get(uri.replace('www.', '').replace('arweave.net', 'gateway.irys.xyz')).then(response => response.data);
  } catch (error) {
    response = await axios.get(uri.replace('gateway.irys.xyz', 'arweave.net')).then(response => response.data);
  }
  return response;
}

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