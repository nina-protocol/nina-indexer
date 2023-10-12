import axios from "axios";

export const decode = (byteArray) => {
  return new TextDecoder().decode(new Uint8Array(byteArray)).replaceAll(/\u0000/g, '');
}

export const uriExtractor = (uri) => {
  return uri.replace('https://www.arweave.net/', '').replace('https://arweave.net/', '');
}

export const fetchFromArweave = async (uri) => {
  let response;
  try {
    response = await axios.get(uri).then(response => response.data);
  } catch (error) {
    response = await axios.get(uri.replace('arweave.net', 'ar-io.net')).then(response => response.data);
  }
  return response;
}