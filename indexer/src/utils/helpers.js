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

export const fetchWithRetry = async (fetchFunction) => {
  let attempts = 0

  const res = await promiseRetry(
    async (retry) => {
      try {
        attempts += 1
        // if (attempts > 1) {
          console.log('Retrying fetchWithRetry', attempts)
        // }
        const result = await fetchFunction
        if (!result || result.message?.includes('not found')) {
          const error = new Error('Failed to fetch')
          console.log('fetchWithRetry error', JSON.stringify(error))
          retry(error)
  
          return
        }
        return result
      } catch(err) {
        console.log('fetchWithRetry error', JSON.stringify(err))
          retry(err)
          return
      }
    }, {
      retries: 50,
      minTimeout: 50,
      maxTimeout: 1000,
    }
  )

  if (!res) {
    throw new Error('Failed to fetch')
  }

  return res
}
