import { Account, Verification } from '@nina-protocol/nina-db';
import { NameRegistryState, getNameAccountKey, getHashedName } from "@bonfida/spl-name-service";
import { Connection } from '@solana/web3.js';
import * as anchor from '@project-serum/anchor';

import {
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
  getEnsForEthAddress,
  getTwitterProfile,
  getSoundcloudProfile,
} from './utils/names.js';
import { logTimestampedMessage } from './utils/logging.js';

const nameAccountSkipList = [
  '79k2rLEdyzgMyyztSXxk3BsZoyysxt4SKv7h47iv4qBo',
  'ApfQPjGAN6pyRor1brdEg7kTehC62oCQJB3TnYKGfzcK',
  '9PXFaDKJRrpa4yW7tofMVpVwZYe68DrAi2Ri8wCexPRo',
  'FcjfZvofUYBbMJPEpv38nfx6XfkzwY6YvnuKFnyercE8'
]

class VerificationSyncer {
  constructor () {
    this.connection = new Connection(process.env.SOLANA_CLUSTER_URL);
    this.provider = new anchor.AnchorProvider(this.connection, {}, { commitment: 'processed' });
    this.isSyncing = false;
  }

  async syncVerifications() {
    try {
      if (this.isSyncing) {
        logTimestampedMessage('Verification sync already in progress');
        return false;
      }
      this.isSyncing = true;
      logTimestampedMessage('Starting verification sync...');

      let ninaIdNameRegistries = await this.provider.connection.getParsedProgramAccounts(
        NAME_PROGRAM_ID, {
          commitment: this.provider.connection.commitment,
          filters: [{
            dataSize: 192
          }, {
            memcmp: {
              offset: 64,
              bytes: NINA_ID.toBase58()
            }
          }]
        }
      );
      
      const existingNameRegistries = await Verification.query();
      const newNameRegistries = ninaIdNameRegistries.filter(x => !existingNameRegistries.find(y => y.publicKey === x.pubkey.toBase58()));
      const deletedNameRegistries = existingNameRegistries.filter(x => !ninaIdNameRegistries.find(y => y.pubkey.toBase58() === x.publicKey));

      for await (let nameRegistry of newNameRegistries) {
        try {
          if (!nameAccountSkipList.includes(nameRegistry.pubkey.toBase58())) {
            await this.processVerification(nameRegistry.pubkey);
          }
        } catch (e) {
          console.warn(`error loading name account: ${nameRegistry.pubkey.toBase58()} ---- ${e}`)
        }
      }
      for await (let nameRegistry of deletedNameRegistries) {
        try {
          await Verification.query().delete().where({ publicKey: nameRegistry.publicKey });
        } catch (e) {
          console.warn(`error deleting name account: ${nameRegistry.publicKey} ---- ${e}`)
        }
      }
      
      for await (let nameRegistry of existingNameRegistries) {
        try {
          if (nameRegistry.type === 'soundcloud') {
            try {
              await axios.get(nameRegistry.image)
            } catch (e) {
              const profile = await getSoundcloudProfile(nameRegistry.value);
              if (profile) {
                await Verification.query().patch({
                  displayName: profile.username,
                  image: profile.avatar_url.replace('-large.jpg', '-t500x500.jpg'),
                  active: true,
                }).where({ publicKey: nameRegistry.publicKey });
              } else {
                if (nameRegistry.active) {
                  await Verification.query().patch({
                    active: false,
                  }).where({ publicKey: nameRegistry.publicKey });  
                }
              }
            }
          }
        } catch (e) {
          console.warn(`error loading name account: ${nameRegistry.publicKey} ---- ${e}`)
        }
      }
      return true
    } catch (error) {
      console.log(`${new Date()} Error processing verifications: ${error}`)
    }
  }
  
  async processVerification (publicKey) {
    try {
      const verification = {
        publicKey: publicKey.toBase58(),
      }
      const { registry } = await NameRegistryState.retrieve(this.provider.connection, publicKey)
      if (registry.parentName.toBase58() === NINA_ID_ETH_TLD.toBase58()) {
        const nameAccountKey = await getNameAccountKey(await getHashedName(registry.owner.toBase58()), NINA_ID, NINA_ID_ETH_TLD);
        const name = await ReverseEthAddressRegistryState.retrieve(this.provider.connection, nameAccountKey)
        const account = await Account.findOrCreate(registry.owner.toBase58());
        verification.accountId = account.id;
        verification.type = 'ethereum'
        verification.value = name.ethAddress
        try {
          const displayName = await getEnsForEthAddress(name.ethAddress);
          if (displayName) {
            verification.displayName = displayName
          }
        } catch (error) {
          console.warn(error)
        }
      } else if (registry.parentName.toBase58() === NINA_ID_IG_TLD.toBase58()) {
        const nameAccountKey = await getNameAccountKey(await getHashedName(registry.owner.toBase58()), NINA_ID, NINA_ID_IG_TLD);
        const name = await ReverseInstagramRegistryState.retrieve(this.provider.connection, nameAccountKey)
        const account = await Account.findOrCreate(registry.owner.toBase58());
        verification.accountId = account.id;
        verification.value = name.instagramHandle
        verification.type = 'instagram'
      } else if (registry.parentName.toBase58() === NINA_ID_SC_TLD.toBase58()) {
        const nameAccountKey = await getNameAccountKey(await getHashedName(registry.owner.toBase58()), NINA_ID, NINA_ID_SC_TLD);
        const name = await ReverseSoundcloudRegistryState.retrieve(this.provider.connection, nameAccountKey)
        const account = await Account.findOrCreate(registry.owner.toBase58());
        verification.accountId = account.id;
        verification.value = name.soundcloudHandle
        verification.type = 'soundcloud'
        const soundcloudProfile = await getSoundcloudProfile(name.soundcloudHandle);
        if (soundcloudProfile) {  
          verification.displayName = soundcloudProfile.username
          verification.image = soundcloudProfile.avatar_url.replace('-large.jpg', '-t500x500.jpg')
          if (soundcloudProfile.description) {
            // verification.description = soundcloudProfile.description
          }
        }
      } else if (registry.parentName.toBase58() === NINA_ID_TW_TLD.toBase58()) {
        const nameAccountKey = await getNameAccountKey(await getHashedName(registry.owner.toBase58()), NINA_ID, NINA_ID_TW_TLD);
        const name = await ReverseTwitterRegistryState.retrieve(this.provider.connection, nameAccountKey)
        const account = await Account.findOrCreate(registry.owner.toBase58());
        verification.accountId = account.id;
        verification.value = name.twitterHandle
        verification.type = 'twitter'
        const twitterProfile = await getTwitterProfile(name.twitterHandle);
        if (twitterProfile) {
          verification.displayName = twitterProfile.name
          verification.image = twitterProfile.profile_image_url?.replace('_normal', '')
          verification.description = twitterProfile.description
        }
      }
      if (verification.value && verification.type) {
        await Verification.query().insertGraph(verification)
        const v = await Verification.query().findOne({ publicKey: verification.publicKey })
        return v;
      }
    } catch (error) {
      console.log('error processing verification', error)
    }
  }
}

export default new VerificationSyncer();