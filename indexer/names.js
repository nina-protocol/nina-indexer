const anchor = require('@project-serum/anchor');
const { NameRegistryState, getNameAccountKey, getHashedName } = require("@bonfida/spl-name-service");
const { deserializeUnchecked, serialize } = require('borsh');
const Web3 = require('web3');
const axios = require('axios');
const ENS = require('ethereum-ens');
const formUrlEncoded = require('form-urlencoded');

const NINA_ID = new anchor.web3.PublicKey("idHukURpSwMbvcRER9pN97tBSsH4pdLSUhnHYwHftd5")
const NINA_ID_ETH_TLD = new anchor.web3.PublicKey("9yQ5NdLpFdALfRjjfBLCQiddvMekwRbCtuSYDCi4mpFc")
const NINA_ID_IG_TLD = new anchor.web3.PublicKey("7JVHPSJdVBNRgYdY3ibP33YksBzjpuBVasLj91Jj9jQA")
const NINA_ID_SC_TLD = new anchor.web3.PublicKey("MguVXe9Z18YDWxm3AZkSdiuRiEJ1UzvEyevFAxycsjw")
const NINA_ID_TW_TLD = new anchor.web3.PublicKey("6nPJTCeFnp3QiLBDtPPkZqMkW3KccVgr1izLTF1Lq7VL")
const NAME_PROGRAM_ID = new anchor.web3.PublicKey("namesLPneVptA9Z5rqUDD9tMTWEJwofgaYwp8cawRkX")

const web3 = new Web3(process.env.ETH_CLUSTER_URL);
const ens = new ENS(web3)
let soundcloudToken = null
let soundcloudTokenDate = null
class ReverseEthAddressRegistryState {
  static schema = new Map([
    [
      ReverseEthAddressRegistryState,
      {
        kind: 'struct',
        fields: [
          ['ethAddressRegistryKey', [32]],
          ['ethAddress', 'string'],
        ],
      },
    ],
  ]);
  constructor(obj) {
    this.ethAddressRegistryKey = obj.ethAddressRegistryKey;
    this.ethAddress = obj.ethAddress;
  }

  static retrieve = async(
    connection,
    reverseEthAddressAccountKey
  ) => {
    const reverseEthAddressAccount = await connection.getAccountInfo(
      reverseEthAddressAccountKey,
      'processed'
    );

    if (!reverseEthAddressAccountKey) {
      throw new Error('Invalid reverse Eth Address account provided');
    }

    const res = deserializeUnchecked(
      this.schema,
      ReverseEthAddressRegistryState,
      reverseEthAddressAccount.data.slice(NameRegistryState.HEADER_LEN)
    );

    return res;
  }

  static createLookupInstructions = async (ethAddress, publicKey) => {
    const nameAccountKey = await getNameAccountKey(await getHashedName(ethAddress), NINA_ID, NINA_ID_ETH_TLD);
    const hashedVerifiedPubkey = await getHashedName(publicKey.toString());
    const reverseRegistryKey = await getNameAccountKey(
      hashedVerifiedPubkey,
      NINA_ID,
      NINA_ID_ETH_TLD
    );

    let ReverseEthAddressRegistryStateBuff = serialize(
      ReverseEthAddressRegistryState.schema,
      new ReverseEthAddressRegistryState({
        ethAddressRegistryKey: nameAccountKey.toBytes(),
        ethAddress,
      })
    );

    const createIx = createInstruction(
      NAME_PROGRAM_ID,
      SystemProgram.programId,
      reverseRegistryKey,
      publicKey,
      publicKey,
      hashedVerifiedPubkey,
      new Numberu64(LAMPORTS_FOR_REVERSE_REGISTRY * 2),
      new Numberu32(ReverseEthAddressRegistryStateBuff.length),
      NINA_ID,
      NINA_ID_ETH_TLD,
      NINA_ID
    )
    const reverseRegistryIx = updateInstruction(
      NAME_PROGRAM_ID,
      reverseRegistryKey,
      new Numberu32(0),
      Buffer.from (ReverseEthAddressRegistryStateBuff),
      NINA_ID,
      NINA_ID_ETH_TLD
    )
    return [createIx, reverseRegistryIx];
  }
}

class ReverseSoundcloudRegistryState {
  static schema = new Map([
    [
      ReverseSoundcloudRegistryState,
      {
        kind: 'struct',
        fields: [
          ['soundcloudRegistryKey', [32]],
          ['soundcloudHandle', 'string'],
        ],
      },
    ],
  ]);
  constructor(obj) {
    this.soundcloudRegistryKey = obj.soundcloudRegistryKey;
    this.soundcloudHandle = obj.soundcloudHandle;
  }

  static retrieve = async(
    connection,
    reverseSoundcloudAccountKey
  ) => {
    const reverseSoundcloudAddressAccount = await connection.getAccountInfo(
      reverseSoundcloudAccountKey,
      'processed'
    );

    if (!reverseSoundcloudAddressAccount) {
      throw new Error('Invalid reverse Soundcloud handle account provided');
    }

    const res = deserializeUnchecked(
      this.schema,
      ReverseSoundcloudRegistryState,
      reverseSoundcloudAddressAccount.data.slice(NameRegistryState.HEADER_LEN)
    );

    return res;
  }

  static createLookupInstructions = async (soundcloudHandle, publicKey) => {
    const nameAccountKey = await getNameAccountKey(await getHashedName(soundcloudHandle), NINA_ID, NINA_ID_SC_TLD);
    const hashedVerifiedPubkey = await getHashedName(publicKey.toString());
    const reverseRegistryKey = await getNameAccountKey(
      hashedVerifiedPubkey,
      NINA_ID,
      NINA_ID_SC_TLD
    );

    let ReverseSoundcloudRegistryStateBuff = serialize(
      ReverseSoundcloudRegistryState.schema,
      new ReverseSoundcloudRegistryState({
        soundcloudRegistryKey: nameAccountKey.toBytes(),
        soundcloudHandle,
      })
    );

    const createIx = createInstruction(
      NAME_PROGRAM_ID,
      SystemProgram.programId,
      reverseRegistryKey,
      publicKey,
      publicKey,
      hashedVerifiedPubkey,
      new Numberu64(LAMPORTS_FOR_REVERSE_REGISTRY * 2),
      new Numberu32(ReverseSoundcloudRegistryStateBuff.length),
      NINA_ID,
      NINA_ID_SC_TLD,
      NINA_ID
    )
    const reverseRegistryIx = updateInstruction(
      NAME_PROGRAM_ID,
      reverseRegistryKey,
      new Numberu32(0),
      Buffer.from (ReverseSoundcloudRegistryStateBuff),
      NINA_ID,
      NINA_ID_SC_TLD
    )
    return [createIx, reverseRegistryIx];
  }
}

class ReverseTwitterRegistryState {
  static schema = new Map([
    [
      ReverseTwitterRegistryState,
      {
        kind: 'struct',
        fields: [
          ['twitterRegistryKey', [32]],
          ['twitterHandle', 'string'],
        ],
      },
    ],
  ]);
  constructor(obj) {
    this.twitterRegistryKey = obj.twitterRegistryKey;
    this.twitterHandle = obj.twitterHandle;
  }

  static retrieve = async(
    connection,
    reverseTwitterAccountKey
  ) => {
    const reverseTwitterAddressAccount = await connection.getAccountInfo(
      reverseTwitterAccountKey,
      'processed'
    );

    if (!reverseTwitterAddressAccount) {
      throw new Error('Invalid reverse Twitter Handle account provided');
    }

    const res = deserializeUnchecked(
      this.schema,
      ReverseTwitterRegistryState,
      reverseTwitterAddressAccount.data.slice(NameRegistryState.HEADER_LEN)
    );

    return res;
  }

  static createLookupInstructions = async (twitterHandle, publicKey) => {
    const nameAccountKey = await getNameAccountKey(await getHashedName(twitterHandle), NINA_ID, NINA_ID_TW_TLD);
    const hashedVerifiedPubkey = await getHashedName(publicKey.toString());
    const reverseRegistryKey = await getNameAccountKey(
      hashedVerifiedPubkey,
      NINA_ID,
      NINA_ID_TW_TLD
    );

    let ReverseTwitterRegistryStateBuff = serialize(
      ReverseTwitterRegistryState.schema,
      new ReverseTwitterRegistryState({
        twitterRegistryKey: nameAccountKey.toBytes(),
        twitterHandle,
      })
    );

    const createIx = createInstruction(
      NAME_PROGRAM_ID,
      SystemProgram.programId,
      reverseRegistryKey,
      publicKey,
      publicKey,
      hashedVerifiedPubkey,
      new Numberu64(LAMPORTS_FOR_REVERSE_REGISTRY * 2),
      new Numberu32(ReverseTwitterRegistryStateBuff.length),
      NINA_ID,
      NINA_ID_TW_TLD,
      NINA_ID
    )
    const reverseRegistryIx = updateInstruction(
      NAME_PROGRAM_ID,
      reverseRegistryKey,
      new Numberu32(0),
      Buffer.from (ReverseTwitterRegistryStateBuff),
      NINA_ID,
      NINA_ID_TW_TLD
    )
    return [createIx, reverseRegistryIx];
  }
}

class ReverseInstagramRegistryState {
  static schema = new Map([
    [
      ReverseInstagramRegistryState,
      {
        kind: 'struct',
        fields: [
          ['instagramRegistryKey', [32]],
          ['instagramHandle', 'string'],
        ],
      },
    ],
  ]);
  constructor(obj) {
    this.instagramRegistryKey = obj.instagramRegistryKey;
    this.instagramHandle = obj.instagramHandle;
  }

  static retrieve = async(
    connection,
    reverseInstagramAccountKey
  ) => {
    const reverseInstagramAddressAccount = await connection.getAccountInfo(
      reverseInstagramAccountKey,
      'processed'
    );

    if (!reverseInstagramAddressAccount) {
      throw new Error('Invalid reverse Instagram Handle account provided');
    }

    const res = deserializeUnchecked(
      this.schema,
      ReverseInstagramRegistryState,
      reverseInstagramAddressAccount.data.slice(NameRegistryState.HEADER_LEN)
    );

    return res;
  }

  static createLookupInstructions = async (instagramHandle, publicKey) => {
    const nameAccountKey = await getNameAccountKey(await getHashedName(instagramHandle), NINA_ID, NINA_ID_IG_TLD);
    const hashedVerifiedPubkey = await getHashedName(publicKey.toString());
    const reverseRegistryKey = await getNameAccountKey(
      hashedVerifiedPubkey,
      NINA_ID,
      NINA_ID_IG_TLD
    );

    let ReverseInstagramRegistryStateBuff = serialize(
      ReverseInstagramRegistryState.schema,
      new ReverseInstagramRegistryState({
        instagramRegistryKey: nameAccountKey.toBytes(),
        instagramHandle,
      })
    );

    const createIx = createInstruction(
      NAME_PROGRAM_ID,
      SystemProgram.programId,
      reverseRegistryKey,
      publicKey,
      publicKey,
      hashedVerifiedPubkey,
      new Numberu64(LAMPORTS_FOR_REVERSE_REGISTRY * 2),
      new Numberu32(ReverseInstagramRegistryStateBuff.length),
      NINA_ID,
      NINA_ID_IG_TLD,
      NINA_ID
    )
    const reverseRegistryIx = updateInstruction(
      NAME_PROGRAM_ID,
      reverseRegistryKey,
      new Numberu32(0),
      Buffer.from (ReverseInstagramRegistryStateBuff),
      NINA_ID,
      NINA_ID_IG_TLD
    )
    return [createIx, reverseRegistryIx];
  }
}

const getEnsForEthAddress = async (ethAddress) => {
  try {
    let ensName
    if (process.env.ETH_CLUSTER_URL) {
      ensName = await ens.reverse(ethAddress);
      ensName = ensName.name();
    }
    return ensName
  } catch (error) {
    console.warn(error)
    return null
  }
}

const getTwitterProfile = async (twitterHandle) => {
  try {
    let twitterProfile
    if (process.env.TWITTER_BEARER_TOKEN) {
      twitterProfile = await fetch(`https://api.twitter.com/2/users/by?usernames=${twitterHandle}&user.fields=profile_image_url,description`, {
        method: "GET",
        headers: {
          "accept": "application/json; charset=utf-8",
          "Authorization": `Bearer ${process.env.TWITTER_BEARER_TOKEN}`
        }
      })
      twitterProfile = await twitterProfile.json()
      if (twitterProfile.errors) {
        throw new Error(twitterProfile.errors[0])
      } else {
        twitterProfile = twitterProfile.data[0]
      }
    }
    return twitterProfile
  } catch (error) {
    console.warn(error)
    return undefined
  }
}

const getSoundcloudProfile = async (soundcloudHandle) => {
  try {
    let soundcloudProfile
    if (process.env.SC_CLIENT_ID && process.env.SC_SECRET) {
      if (!soundcloudToken || (Date.now() - soundcloudTokenDate > 60 * 60 * 1000)) {
        const form = {
          client_id: process.env.SC_CLIENT_ID,
          client_secret: process.env.SC_SECRET,
          grant_type: "client_credentials",
        }
        
        const tokenResponse = await fetch("https://api.soundcloud.com/oauth2/token", {
          body: formUrlEncoded(form),
          method: "POST",
          headers: {
            "accept": "application/json; charset=utf-8",
            "Content-Type": "application/x-www-form-urlencoded"
          }
        })
        const tokenData = await tokenResponse.json()
        soundcloudToken = tokenData
        soundcloudTokenDate = new Date()
      }

      let userResponse = await fetch(`https://api.soundcloud.com/users?q=${soundcloudHandle}&limit=50&linked_partitioning=false`, {
        method: "GET",
        headers: {
          "accept": "application/json; charset=utf-8",
          "Authorization": `OAuth ${soundcloudToken.access_token}`
        }
      })
      userResponse = await userResponse.json()
      soundcloudProfile = userResponse.collection.find(user => user.permalink === soundcloudHandle)
      return soundcloudProfile
    }
  } catch (error) {
    console.warn(error)
    return null
  }
}


module.exports = {
  NAME_PROGRAM_ID,
  NINA_ID,
  NINA_ID_ETH_TLD,
  NINA_ID_SC_TLD,
  NINA_ID_TW_TLD,
  NINA_ID_IG_TLD,
  ReverseEthAddressRegistryState,
  ReverseSoundcloudRegistryState,
  ReverseTwitterRegistryState,
  ReverseInstagramRegistryState,
  getNameAccountKey,
  getHashedName,
  NameRegistryState,
  getEnsForEthAddress,
  getTwitterProfile,
  getSoundcloudProfile
}