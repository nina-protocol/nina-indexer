export const decode = (byteArray) => {
  return new TextDecoder().decode(new Uint8Array(byteArray)).replaceAll(/\u0000/g, '');
}

export const uriExtractor = (uri) => {
  return uri.replace('https://www.arweave.net/', '').replace('https://arweave.net/', '');
}

export const logger = (message) => {
  console.log(`${new Date()} - ${message}`)
}
