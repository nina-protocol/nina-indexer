import axios from "axios";
import promiseRetry from 'promise-retry';

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

export const warmCache = async (image, delay=1000) => {
  try {
    const handleWarmCache = async (image) => {
      if (process.env.IMGIX_API_KEY) {
        await new Promise(r => setTimeout(r, delay));
        try {
          await axios.post('https://api.imgix.com/api/v1/purge', {
            data: {
              attributes: {
                url: `${process.env.IMGIX_SOURCE_DOMAIN}/${encodeURIComponent(image.replace('www.', '').replace('arweave.net', 'gateway.irys.xyz'))}`
              },
              type: 'purges'
            }
          }, {
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${process.env.IMGIX_API_KEY}`
            }
          })
          console.log('Warmed Cache On Image:', image)
        } catch (error) {
          console.log('Error warming cache: ', image)          
        }
      }
    }
    handleWarmCache(image);
    if (delay > 1000) {
      let i = 0
      while (i < 10) {
        await new Promise(r => setTimeout(r, 10000));
        handleWarmCache(image);
        i++;
      }
    }
  } catch (err) {
    console.log('Error warming cache:', err.toString());
  }
}

export const callRpcMethodWithRetry = async (method) => {
  return await promiseRetry(async (retry, number) => {
    
    return method()
      .catch((err) => {
        console.log('error', err);
        if (err?.code?.includes('TIMEOUT')) {
            console.log(`RPC Call timed out - total attempts: ${number}.  Retrying...`);
            retry(err);
        }
    
        throw err;
      });
  }, {
    retries: 25,
    minTimeout: 500,
    maxTimeout: 1000,
  })
}
