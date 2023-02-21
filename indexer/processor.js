import anchor from '@project-serum/anchor';
import { Metaplex } from '@metaplex-foundation/js';
import axios from 'axios';
import {
  Account,
  Exchange,
  Hub,
  Post,
  Release,
  Subscription,
  Transaction,
  Verification,
} from '@nina-protocol/nina-db';
import { NameRegistryState, getNameAccountKey, getHashedName } from "@bonfida/spl-name-service";
import { decode, uriExtractor } from './utils.js';
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
} from './names.js';

const MAX_PARSED_TRANSACTIONS = 150
const MAX_TRANSACTION_SIGNATURES = 1000

const blacklist = [
  'BpZ5zoBehKfKUL2eSFd3SNLXmXHi4vtuV4U6WxJB3qvt',
  'FNZbs4pdxKiaCNPVgMiPQrpzSJzyfGrocxejs8uBWnf',
]

const nameAccountSkipList = [
  '79k2rLEdyzgMyyztSXxk3BsZoyysxt4SKv7h47iv4qBo',
  'ApfQPjGAN6pyRor1brdEg7kTehC62oCQJB3TnYKGfzcK',
  '9PXFaDKJRrpa4yW7tofMVpVwZYe68DrAi2Ri8wCexPRo',
  'FcjfZvofUYBbMJPEpv38nfx6XfkzwY6YvnuKFnyercE8'
]

class NinaProcessor {
  constructor() {
    this.provider = null;
    this.tokenIndexProvider = null;
    this.program = null;
    this.metaplex = null;
    this.latestSignature = null;
  }

  async init() {
    const connection = new anchor.web3.Connection(process.env.SOLANA_CLUSTER_URL);
    this.provider = new anchor.AnchorProvider(connection, {}, {commitment: 'processed'})  
    const tokenIndexConnection = new anchor.web3.Connection(process.env.SOLANA_TOKEN_INDEX_CLUSTER_URL);
    this.tokenIndexProvider = new anchor.AnchorProvider(tokenIndexConnection, {commitment: 'processed'});
    this.program = await anchor.Program.at(
      process.env.NINA_PROGRAM_ID,
      this.provider,
    )
    this.metaplex = new Metaplex(connection);
  }

  async runDbProcesses() {
    try {
      await this.processReleases();
      await this.processPosts();
      await this.processHubs();
      await this.processSubscriptions();
      await this.processVerifications();
      await this.processExchangesAndTransactions();
    } catch (error) {
      console.warn(error)
    }
  }

  async processVerifications() {
    
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
        if (nameRegistry.type === 'twitter') {
          try {
            await axios.get(nameRegistry.image)
          } catch (e){
            const profile = await getTwitterProfile(nameRegistry.value);
            if (profile) {
              await Verification.query().patch({
                displayName: profile.name,
                image: profile.profile_image_url.replace('_normal', ''),
                description: profile.description,
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
          verification.image = soundcloudProfile.avatar_url
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

  async addCollectorForRelease(releasePublicKey, accountPublicKey) {
    try {
      const release = await Release.query().findOne({ publicKey: releasePublicKey })
      if (release) {
        const account = await Account.findOrCreate(accountPublicKey)
        const collectors = await release.$relatedQuery('collectors')
        if (!collectors.find(c => c.id === account.id)) {
          await release.$relatedQuery('collectors').relate(account.id);
          console.log('added collector to release')
        }
      }
    } catch (error) {
      console.log('error addCollectorForRelease: ', error)
    }
  }

  async processExchangesAndTransactions() {
    try {
      const signatures = (await this.getSignatures(this.provider.connection, this.latestSignature, this.latestSignature === null)).reverse()
      const pages = []
      for (let i = 0; i < signatures.length; i += MAX_PARSED_TRANSACTIONS) {
        pages.push(signatures.slice(i, i + MAX_PARSED_TRANSACTIONS))
      }

      const exchangeInits = []
      const exchangeCancels = []
      const completedExchanges = []
      const coder = new anchor.BorshInstructionCoder(this.program.idl)
      for await (let page of pages) {
        const txIds = page.map(signature => signature.signature)
        const txs = await this.provider.connection.getParsedTransactions(txIds)
        let i = 0
        for await (let tx of txs) {
          try {
            if (tx) {
              const ninaInstruction = tx.transaction.message.instructions.find(i => i.programId.toBase58() === process.env.NINA_PROGRAM_ID)
              const accounts = ninaInstruction?.accounts
              const blocktime = tx.blockTime
              const datetime = new Date(blocktime * 1000).toISOString()
              const txid = txIds[i]
              console.log(`processing tx: ${txid} - ${blocktime} - ${datetime}`)
              let transactionRecord = await Transaction.query().findOne({ txid })
              if (!transactionRecord) {
                let transactionObject = {
                  txid,
                  blocktime,
                }
                let hubPublicKey
                let accountPublicKey
                let releasePublicKey
                let postPublicKey
                let toAccountPublicKey
                let toHubPublicKey
                if (tx.meta.logMessages.some(log => log.includes('HubInitWithCredit'))) {
                  transactionObject.type = 'HubInitWithCredit'
                  hubPublicKey = accounts[1].toBase58()
                  accountPublicKey = accounts[0].toBase58()
                } else if (tx.meta.logMessages.some(log => log.includes('ReleaseInitWithCredit'))) {
                  transactionObject.type = 'ReleaseInitWithCredit'
                  releasePublicKey = accounts[0].toBase58()
                  accountPublicKey = accounts[4].toBase58()
                } else if (tx.meta.logMessages.some(log => log.includes('ReleaseInitViaHub'))) {
                  transactionObject.type = 'ReleaseInitViaHub'
                  releasePublicKey = accounts[1].toBase58()
                  accountPublicKey = accounts[0].toBase58()
                  hubPublicKey = accounts[4].toBase58()
                } else if (tx.meta.logMessages.some(log => log.includes('ReleasePurchaseViaHub'))) {
                  transactionObject.type = 'ReleasePurchaseViaHub'
                  releasePublicKey = accounts[2].toBase58()
                  accountPublicKey = accounts[0].toBase58()
                  hubPublicKey = accounts[8].toBase58()
                  await this.addCollectorForRelease(releasePublicKey, accountPublicKey)
                } else if (tx.meta.logMessages.some(log => log.includes('ReleasePurchase'))) {
                  transactionObject.type = 'ReleasePurchase'
                  releasePublicKey = accounts[2].toBase58()
                  accountPublicKey = accounts[0].toBase58()
                  await this.addCollectorForRelease(releasePublicKey, accountPublicKey)
                } else if (tx.meta.logMessages.some(log => log.includes('HubAddCollaborator'))) {
                  transactionObject.type = 'HubAddCollaborator'
                  hubPublicKey = accounts[2].toBase58()
                  accountPublicKey = accounts[0].toBase58()
                  toAccountPublicKey = accounts[4].toBase58()
                } else if (tx.meta.logMessages.some(log => log.includes('HubAddRelease'))) {
                  transactionObject.type = 'HubAddRelease'
                  releasePublicKey = accounts[5].toBase58()
                  accountPublicKey = accounts[0].toBase58()
                  hubPublicKey = accounts[1].toBase58()
                } else if (tx.meta.logMessages.some(log => log.includes('PostInitViaHubWithReferenceRelease'))) {
                  transactionObject.type = 'PostInitViaHubWithReferenceRelease'
                  postPublicKey = accounts[2].toBase58()
                  releasePublicKey = accounts[7].toBase58()
                  accountPublicKey = accounts[0].toBase58()
                  hubPublicKey = accounts[1].toBase58()
                } else if (tx.meta.logMessages.some(log => log.includes('PostInitViaHub'))) {
                  transactionObject.type = 'PostInitViaHub'
                  postPublicKey = accounts[2].toBase58()
                  accountPublicKey = accounts[0].toBase58()
                  hubPublicKey = accounts[1].toBase58()
                } else if (tx.meta.logMessages.some(log => log.includes('SubscriptionSubscribeAccount'))) {
                  transactionObject.type = 'SubscriptionSubscribeAccount'
                  accountPublicKey = accounts[0].toBase58()
                  toAccountPublicKey = accounts[2].toBase58()
                } else if (tx.meta.logMessages.some(log => log.includes('SubscriptionSubscribeHub'))) {
                  transactionObject.type = 'SubscriptionSubscribeHub'
                  accountPublicKey = accounts[0].toBase58()
                  toHubPublicKey = accounts[2].toBase58()
                } else {
                  if (accounts?.length === 10) {
                    if (accounts[0].toBase58() === accounts[1].toBase58()) {
                      try {
                        const release = await Release.query().findOne({ publicKey: accounts[2].toBase58() })
                        if (release) {
                          transactionObject.type = 'ReleasePurchase'
                          releasePublicKey = accounts[2].toBase58()
                          accountPublicKey = accounts[0].toBase58()
                        }
                      } catch (error) {
                        console.log(error)
                      }
                    } else if (accounts[3].toBase58() === accounts[4].toBase58()) {
                      try {
                        const release = await Release.query().findOne({ publicKey: accounts[0].toBase58() })
                        if (release) {
                          transactionObject.type = 'ReleasePurchase'
                          releasePublicKey = accounts[0].toBase58()
                          accountPublicKey = accounts[3].toBase58()
                        }
                      } catch (error) {
                        console.log(error)
                      }
                    }
                  }

                  if (accounts && !transactionObject.type) {
                    if (accounts.length === 13) {
                      try {
                        const mintPublicKey = accounts[1]
                        await this.provider.connection.getTokenSupply(mintPublicKey)
                        const config = coder.decode(ninaInstruction.data, 'base58').data.config
                        exchangeInits.push({
                          expectedAmount: config.isSelling ? config.expectedAmount.toNumber() / 1000000 : 1,
                          initializerAmount: config.isSelling ? 1 : config.initializerAmount.toNumber() / 1000000,
                          publicKey: accounts[5].toBase58(),
                          release: accounts[9].toBase58(),
                          isSale: config.isSelling,
                          initializer: accounts[0].toBase58(),
                          createdAt: datetime
                        })
                        transactionObject.type = 'ExchangeInit'
                        releasePublicKey = accounts[9].toBase58()
                        accountPublicKey = accounts[0].toBase58()
                        console.log('found an exchange init', accounts[5].toBase58())
                      } catch (error) {
                        console.log('error not a token mint: ', txid, error)
                      }
                    } else if (accounts.length === 6) {
                      exchangeCancels.push({
                        publicKey: accounts[2].toBase58(),
                        updatedAt: datetime
                      })
                      console.log('found an exchange cancel', accounts[2].toBase58())
                    } else if (accounts.length === 16) {
                      completedExchanges.push({
                        publicKey: accounts[2].toBase58(),
                        legacyExchangePublicKey: accounts[7].toBase58(),
                        completedBy: accounts[0].toBase58(),
                        updatedAt: datetime
                      })
                      transactionObject.type = 'ExchangeAccept'
                      releasePublicKey = accounts[12].toBase58()
                      accountPublicKey = accounts[0].toBase58()
                      console.log('found an exchange completed', accounts[2].toBase58())
                    }
                  }

                  if (accounts && !transactionObject.type) {
                    transactionObject.type = 'Unknown'
                    accountPublicKey = tx.transaction.message.accountKeys[0].pubkey.toBase58()
                  }
                }
                if (transactionObject.type) {
                  if (accountPublicKey) {
                    const account = await Account.findOrCreate(accountPublicKey)
                    if (account) {
                      transactionObject.authorityId = account.id
                    }
                  }
      
                  if (hubPublicKey) {
                    const hub = await Hub.query().findOne({ publicKey: hubPublicKey })
                    if (hub) {
                      transactionObject.hubId = hub.id
                    }
                  }
      
                  if (releasePublicKey && blacklist.indexOf(releasePublicKey) === -1) {
                    const release = await Release.findOrCreate(releasePublicKey)
                    if (release) {
                      transactionObject.releaseId = release.id
                    }
                  }
      
                  if (postPublicKey) {
                    const post = await Post.query().findOne({ publicKey: postPublicKey })
                    if (post) {
                      transactionObject.postId = post.id
                    }
                  }
      
                  if (toAccountPublicKey) {
                    const subscribeToAccount = await Account.findOrCreate(toAccountPublicKey)
                    if (subscribeToAccount) {
                      transactionObject.toAccountId = subscribeToAccount.id
                    }
                  }
      
                  if (toHubPublicKey) {
                    const subscribeToHub = await Hub.query().findOne({ publicKey: toHubPublicKey })
                    if (subscribeToHub) {
                      transactionObject.toHubId = subscribeToHub.id
                    }
                  }
  
                  await Transaction.query().insertGraph(transactionObject)
                }
              }
            }
          } catch (error) {
            console.log('error processing tx', error)
          }
          this.latestSignature = page[i]
          i++
        }
      }

      for await (let exchangeInit of exchangeInits) {
        try {
          const release = await Release.query().findOne({publicKey: exchangeInit.release});
          if (release) {
            const initializer = await Account.findOrCreate(exchangeInit.initializer);
            await Exchange.query().insertGraph({
              publicKey: exchangeInit.publicKey,
              expectedAmount: exchangeInit.expectedAmount,
              initializerAmount: exchangeInit.initializerAmount,
              isSale: exchangeInit.isSale,
              cancelled: false,
              initializerId: initializer.id,
              releaseId: release.id,
              createdAt: exchangeInit.createdAt,
            })
            console.log('Inserted Exchange:', exchangeInit.publicKey);
          }
        } catch (error) {
          console.log('error processing exchangeInits: ', error)
        }
      }

      for await (let exchangeCancel of exchangeCancels) {
        try {
          const exchange = await Exchange.query().findOne({publicKey: exchangeCancel.publicKey});
          if (exchange) {
            exchange.cancelled = true;
            await Exchange.query().patch({
              cancelled: true,
              updatedAt: exchangeCancel.updatedAt,
            }).findById(exchange.id);
            console.log('Cancelled Exchange:', exchangeCancel.publicKey);
          }
        } catch (error) {
          console.log('error processing exchangeCancels: ', error)
        }
      }

      for await (let completedExchange of completedExchanges) {
        try {
          let exchange = await Exchange.query().findOne({publicKey: completedExchange.publicKey});
          if (!exchange) {
            exchange = await Exchange.query().findOne({publicKey: completedExchange.legacyExchangePublicKey});
          }
          if (exchange) {
            const completedBy = await Account.findOrCreate(completedExchange.completedBy);
            await Exchange.query().patch({updatedAt: completedExchange.updatedAt, completedById: completedBy.id}).findById(exchange.id);
            console.log('Completed Exchange:', completedExchange.publicKey);
          } else {
            console.log('could not find exchange: ', completedExchange.publicKey)
          }
        } catch (error) {
          console.log('error processing completedExchanges: ', error)
        }
      }
    } catch (error) {
      console.log('error processing transactions: ', error)
    }
  }

  async processReleases() {
    // Get all releases that are not on the blacklist
    try {
      const releases = (await this.program.account.release.all()).filter(x => !blacklist.includes(x.publicKey.toBase58()));
      const releaseMints = releases.map(x => x.account.releaseMint)
      const metadataAccounts = (await this.metaplex.nfts().findAllByMintList({mints: releaseMints})).filter(x => x);
      const existingReleases = await Release.query();
  
      const allMints = metadataAccounts.map(x => x.mintAddress.toBase58());
      const newMints = allMints.filter(x => !existingReleases.find(y => y.mint === x));
      const newMetadata = metadataAccounts.filter(x => newMints.includes(x.mintAddress.toBase58()));
      const newReleasesWithMetadata = releases.filter(x => newMints.includes(x.account.releaseMint.toBase58()));
      
      let newMetadataJson
      try {
        newMetadataJson = await axios.all(
          newMetadata.map(metadata => axios.get(metadata.uri))
        ).then(axios.spread((...responses) => responses))
      } catch (error) {
        newMetadataJson = await axios.all(
          newMetadata.map(metadata => axios.get(metadata.uri.replace('arweave.net', 'ar-io.net')))
        ).then(axios.spread((...responses) => responses))
      }
  
      for await (let release of newReleasesWithMetadata) {
        try {
          const metadata = metadataAccounts.find(x => x.mintAddress.toBase58() === release.account.releaseMint.toBase58());
          const metadataJson = newMetadataJson.find(x => x.config.url.includes(uriExtractor(metadata.uri))).data;
    
          let publisher = await Account.findOrCreate(release.account.authority.toBase58());
    
          await Release.createRelease({
            publicKey: release.publicKey.toBase58(),
            mint: release.account.releaseMint.toBase58(),
            metadata: metadataJson,
            datetime: new Date(release.account.releaseDatetime.toNumber() * 1000).toISOString(),
            publisherId: publisher.id,
            releaseAccount: release
          })
        } catch (err) {
          console.log(err);
        }
      }
  
      for await (let releaseRecord of existingReleases) {
        try {
          const release = releases.find(x => x.publicKey.toBase58() === releaseRecord.publicKey);
          if (release) {
            await Release.processRevenueShares(release, releaseRecord);
          }
        } catch (error) {
          console.log('error Release.processRevenueShares existingReleases: ', error)
        }
      }
    } catch (error) {
      console.log('error processing releases: ', error)
    }
  }
  
  async processPosts() {
    try {
      const hubContents = await this.program.account.hubContent.all();
      const hubPosts = await this.program.account.hubPost.all();
      const posts = await this.program.account.post.all();
      const existingPosts = await Post.query();
      const newPosts = posts.filter(x => !existingPosts.find(y => y.publicKey === x.publicKey.toBase58()));
  
      let newPostsJson
      try {
        newPostsJson = await axios.all(
          newPosts.map(post => axios.get(decode(post.account.uri)))
        ).then(axios.spread((...responses) => responses))
      } catch (error) {
        newPostsJson = await axios.all(
          newPosts.map(post => axios.get(decode(post.account.uri).replace('arweave.net', 'ar-io.net')))
        ).then(axios.spread((...responses) => responses))
      }
  
      for await (let newPost of newPosts) {
        try {
          const hubPost = hubPosts.find(x => x.account.post.toBase58() === newPost.publicKey.toBase58());
          const hubContent = hubContents.filter(x => x.account.child.toBase58() === hubPost.publicKey.toBase58())[0];
          if (hubContent.account.visible) {
            const publisher = await Account.findOrCreate(newPost.account.author.toBase58());
            const decodedUri = decode(newPost.account.uri);
            await Post.query().insertGraph({
              publicKey: newPost.publicKey.toBase58(),
              data: newPostsJson.find(x => x.config.url.includes(uriExtractor(decodedUri))).data,
              datetime: new Date(newPost.account.createdAt.toNumber() * 1000).toISOString(),
              publisherId: publisher.id,
            })
            console.log('Inserted Post:', newPost.publicKey.toBase58());
          }
        } catch (err) {
          console.log(err);
        }
      }
    } catch (error) {
      console.log('error processing posts: ', error)
    }
  }

  async processHubs() {
    const hubs = await this.program.account.hub.all();
    const hubContent = await this.program.account.hubContent.all();
    const hubReleases = await this.program.account.hubRelease.all();
    const hubCollaborators = await this.program.account.hubCollaborator.all();
    const hubPosts = await this.program.account.hubPost.all();

    const existingHubs = await Hub.query();

    for await (let existingHub of existingHubs) {
      const hubReleasesForHubOnChain = hubReleases.filter(x => x.account.hub.toBase58() === existingHub.publicKey);
      const hubReleasesForHubDb = (await Hub.relatedQuery('releases').for(existingHub)).map(x => x.publicKey);
      const newHubReleasesForHub = hubReleasesForHubOnChain.filter(x => !hubReleasesForHubDb.includes(x.account.release.toBase58()));
  

      const hubCollaboratorsForHubOnChain = hubCollaborators.filter(x => x.account.hub.toBase58() === existingHub.publicKey);
      const hubCollaboratorsForHubDb = (await Hub.relatedQuery('collaborators').for(existingHub)).map(x => x.publicKey);
      const newHubCollaboratorsForHub = hubCollaboratorsForHubOnChain.filter(x => !hubCollaboratorsForHubDb.includes(x.account.collaborator.toBase58()));
  
      const hubPostsForHubOnChain = hubPosts.filter(x => x.account.hub.toBase58() === existingHub.publicKey);
      const hubPostsForHubDb = (await Hub.relatedQuery('posts').for(existingHub)).map(x => x.publicKey);
      const newHubPostsForHub = hubPostsForHubOnChain.filter(x => !hubPostsForHubDb.includes(x.account.post.toBase58()));
      

      const hubContentsForHub = hubContent.filter(x => x.account.hub.toBase58() === existingHub.publicKey)

      const hubAccount = hubs.find(x => x.publicKey.toBase58() === existingHub.publicKey);
      await this.updateHub(
        existingHub,
        hubAccount,
        hubContentsForHub,
        {
          hubReleasesForHubOnChain,
          hubReleasesForHubDb,
          newHubReleasesForHub
        }, {
          hubCollaboratorsForHubOnChain,
          hubCollaboratorsForHubDb,
          newHubCollaboratorsForHub
        }, {
          hubPostsForHubOnChain,
          hubPostsForHubDb,
          newHubPostsForHub
        });
    }
    
    let newHubs = hubs.filter(x => !existingHubs.find(y => y.publicKey === x.publicKey.toBase58()));
    newHubs.forEach(hub => {
      hub.account.uri = decode(hub.account.uri);
    })
    newHubs = newHubs.filter(hub => hub.account.uri.indexOf("arweave.net") > -1)

    let newHubsJson
    try {
      newHubsJson = await axios.all(
        newHubs.map(hub => axios.get(hub.account.uri))
      ).then(axios.spread((...responses) => responses))
    } catch (error) {
      newHubsJson = await axios.all(
        newHubs.map(hub => axios.get(hub.account.uri.replace('arweave.net', 'ar-io.net')))
      ).then(axios.spread((...responses) => responses))
    }

    for await (let newHub of newHubs) {
      try {
        const data = newHubsJson.find(x => x.config.url.includes(uriExtractor(newHub.account.uri))).data
        let authority = await Account.findOrCreate(newHub.account.authority.toBase58());
        const hub = await Hub.query().insertGraph({
          publicKey: newHub.publicKey.toBase58(),
          handle: decode(newHub.account.handle),
          data,
          dataUri: newHub.account.uri,
          datetime: new Date(newHub.account.datetime.toNumber() * 1000).toISOString(),
          authorityId: authority.id,
        });
        console.log('Inserted Hub:', newHub.publicKey.toBase58());
        
        const hubReleasesForHubOnChain = hubReleases.filter(x => x.account.hub.toBase58() === hub.publicKey);
        const hubReleasesForHubDb = (await Hub.relatedQuery('releases').for(hub)).map(x => x.publicKey);
        const newHubReleasesForHub = hubReleasesForHubOnChain.filter(x => !hubReleasesForHubDb.includes(x.account.release.toBase58()));
    
  
        const hubCollaboratorsForHubOnChain = hubCollaborators.filter(x => x.account.hub.toBase58() === hub.publicKey);
        const hubCollaboratorsForHubDb = (await Hub.relatedQuery('collaborators').for(hub)).map(x => x.publicKey);
        const newHubCollaboratorsForHub = hubCollaboratorsForHubOnChain.filter(x => !hubCollaboratorsForHubDb.includes(x.account.collaborator.toBase58()));
    
        const hubPostsForHubOnChain = hubPosts.filter(x => x.account.hub.toBase58() === hub.publicKey);
        const hubPostsForHubDb = (await Hub.relatedQuery('posts').for(hub)).map(x => x.publicKey);
        const newHubPostsForHub = hubPostsForHubOnChain.filter(x => !hubPostsForHubDb.includes(x.account.post.toBase58()));
        
  
        const hubContentsForHub = hubContent.filter(x => x.account.hub.toBase58() === hub.publicKey)
  
        await this.updateHub(
          hub,
          newHub,
          hubContentsForHub,
          {
            hubReleasesForHubOnChain,
            hubReleasesForHubDb,
            newHubReleasesForHub
          }, {
            hubCollaboratorsForHubOnChain,
            hubCollaboratorsForHubDb,
            newHubCollaboratorsForHub
          }, {
            hubPostsForHubOnChain,
            hubPostsForHubDb,
            newHubPostsForHub
          });
      } catch (err) {
        console.log(err);
      }
    }
  }

  async processSubscriptions() {
    const subscriptions = await this.program.account.subscription.all();
    const existingSubscriptions = await Subscription.query();

    let newSubscriptions = subscriptions.filter(x => !existingSubscriptions.find(y => y.publicKey === x.publicKey.toBase58()));

    for await (let newSubscription of newSubscriptions) {
      try {
        await Subscription.query().insert({
          publicKey: newSubscription.publicKey.toBase58(),
          datetime: new Date(newSubscription.account.datetime.toNumber() * 1000).toISOString(),
          from: newSubscription.account.from.toBase58(),
          to: newSubscription.account.to.toBase58(),
          subscriptionType: Object.keys(newSubscription.account.subscriptionType)[0],
        });
        console.log('Inserted Subscription:', newSubscription.publicKey.toBase58());
      } catch (err) {
        console.log(err);
      }
    }

    let unsubscribes = existingSubscriptions.filter(x => !subscriptions.find(y => y.publicKey.toBase58() === x.publicKey));
    for await (let unsubscribe of unsubscribes) {
      try {
        await Subscription.query().delete().where('publicKey', unsubscribe.publicKey)
        console.log('Deleted Subscription:', unsubscribe.publicKey);
      } catch (err) {
        console.log(err);
      }
    }
  }

  async processCollectors() {
    const releases = (await this.program.account.release.all()).filter(x => !blacklist.includes(x.publicKey.toBase58()));
    const releaseMints = releases.map(x => x.account.releaseMint)
    const metadataAccounts = (await this.metaplex.nfts().findAllByMintList({mints: releaseMints})).filter(x => x);

    const exchanges = await this.program.account.exchange.all();

    for await (let metadata of metadataAccounts) {
      try {
        const release = releases.filter(x => x.account.releaseMint.toBase58() === metadata.mintAddress.toBase58())[0];
        const releaseInDb = await Release.query().findOne({publicKey: release.publicKey.toBase58()});
        const existingCollectorsInDb = await releaseInDb
          .$relatedQuery('collectors')
          .select('accountId', 'publicKey')
        
          let tokenAccountsForRelease = await this.tokenIndexProvider.connection.getParsedProgramAccounts(
          new anchor.web3.PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"), {
          commitment: this.provider.connection.commitment,
          filters: [{
              dataSize: 165
            }, {
              memcmp: {
                offset: 0,
                bytes: release.account.releaseMint.toBase58()
              }
            }
          ]
        })
        
        const existingCollectorsOnChain = []
        for await(let tokenAccount of tokenAccountsForRelease) {
          try {
            let response = await this.tokenIndexProvider.connection.getTokenAccountBalance(tokenAccount.pubkey, this.provider.connection.commitment)
            if (response.value.uiAmount > 0) {
              let collectorPubkey = tokenAccount.account.data.parsed.info.owner
              const isCollectorExchange = exchanges.filter(x => x.account.exchangeSigner.toBase58() === collectorPubkey)[0];
              if (isCollectorExchange) {
                collectorPubkey = isCollectorExchange.account.initializer.toBase58();
              }
              existingCollectorsOnChain.push(collectorPubkey);
              if (!existingCollectorsInDb.map(x => x.publicKey).includes(collectorPubkey)) {
                const account = await Account.findOrCreate(collectorPubkey);
                try {
                  await releaseInDb.$relatedQuery('collectors').relate(account.id);
                  console.log('Inserted Collector For Release:', collectorPubkey, release.publicKey.toBase58());
                } catch (error) {
                  console.warn(error)
                }
              }
            }
          } catch (err) {
            console.log(err)
          }
        }
  
        const collectorsToRemoveFromDb = existingCollectorsInDb.filter(x => !existingCollectorsOnChain.includes(x.publicKey));
        for await (let collectorToRemove of collectorsToRemoveFromDb) {
          try {
            await releaseInDb.$relatedQuery('collectors').unrelate().where('accountId', collectorToRemove.accountId);
            console.log('Removed Collector From Release:', collectorToRemove.publicKey, release.publicKey.toBase58());
          } catch (err) {
            console.log(err);
          }
        }      
      } catch (err) {
        console.log(err)
      }
    }
  }

  async getSignatures (connection, tx=undefined, isBefore=true, existingSignatures=[]) {
    try {
      const options = {}
      if (tx && isBefore) {
        options.before = tx.signature
      } else if (!isBefore && tx) {
        options.until = tx.signature
      }
      const newSignatures = await connection.getConfirmedSignaturesForAddress2(new anchor.web3.PublicKey(process.env.NINA_PROGRAM_ID), options)
      let signature
      if (isBefore) {
        signature = newSignatures.reduce((a, b) => a.blockTime < b.blockTime ? a : b)  
      } else if (tx) {
        signature = tx.signature  
      }
      if (newSignatures.length > 0) {
        existingSignatures.push(...newSignatures)
      }
      if (existingSignatures.length % MAX_TRANSACTION_SIGNATURES === 0 && newSignatures.length > 0) {
        return await this.getSignatures(connection, signature, isBefore, existingSignatures)
      }
      return existingSignatures
    } catch (error) {
      console.warn (error)
    }
  }

  async updateHub(hub, hubAccount, hubContents, hubReleases, hubCollaborators, hubPosts) {
    if (typeof hubAccount.account.uri !== 'string') {
      hubAccount.account.uri = decode(hubAccount.account.uri)
    }
    if (!hub.dataUri || hub.dataUri !== hubAccount.account.uri) {
      let data 
      try {
        data = (await axios.get(hubAccount.account.uri)).data;
      } catch (error) {
        data = (await axios.get(hubAccount.account.uri.replace('arweave.net', 'ar-io.net'))).data;
      }
      await hub.$query().patch({
        data,
        dataUri: hubAccount.account.uri
      });
    }
  
    // Update Hub Releases
    const hubReleasesForHubOnChain = hubReleases.hubReleasesForHubOnChain;
    const hubReleasesForHubDb = hubReleases.hubReleasesForHubDb;
    const newHubReleasesForHub = hubReleases.newHubReleasesForHub;
  
    for await (let hubRelease of hubReleasesForHubOnChain) {
      try {
        if (hubReleasesForHubDb.includes(hubRelease.account.release.toBase58())) {
          const hubContent = hubContents.filter(x => x.account.child.toBase58() === hubRelease.publicKey.toBase58())[0]
          const release = await Release.query().findOne({publicKey: hubRelease.account.release.toBase58()});
          if (release) {
            await Hub.relatedQuery('releases').for(hub.id).patch({
              visible: hubContent.account.visible,
            }).where( {id: release.id });
          }
        }
      } catch (err) {
        console.log(err);
      }
    }
    for await (let hubRelease of newHubReleasesForHub) {
      try {
        const hubContent = hubContents.filter(x => x.account.child.toBase58() === hubRelease.publicKey.toBase58())[0]
        const release = await Release.query().findOne({publicKey: hubRelease.account.release.toBase58()});
        if (release) {
          await Hub.relatedQuery('releases').for(hub.id).relate({
            id: release.id,
            hubReleasePublicKey: hubRelease.publicKey.toBase58(),
            visible: hubContent.account.visible,
          });
          if (hubContent.account.publishedThroughHub) {
            await release.$query().patch({hubId: hub.id});
          }
          console.log('Related Release to Hub:', release.publicKey, hub.publicKey);  
        }
      } catch (err) {
        console.log(err);
      }
    }
    
    // Update Hub Collaborators
    const hubCollaboratorsForHubOnChain = hubCollaborators.hubCollaboratorsForHubOnChain;
    const hubCollaboratorsForHubDb = hubCollaborators.hubCollaboratorsForHubDb
    const newHubCollaboratorsForHub = hubCollaborators.newHubCollaboratorsForHub
    for await (let hubCollaborator of newHubCollaboratorsForHub) {
      try {
        const collaboratorRecord = await Account.findOrCreate(hubCollaborator.account.collaborator.toBase58());
        if (collaboratorRecord) {
          await Hub.relatedQuery('collaborators').for(hub.id).relate({
            id: collaboratorRecord.id,
            hubCollaboratorPublicKey: hubCollaborator.publicKey.toBase58(),
          })
          console.log('Related Collaborator to Hub:', collaboratorRecord.publicKey, hub.publicKey);
        }
      } catch (err) {
        console.log(err);
      }
    }
  
    const removedCollaborators = hubCollaboratorsForHubDb.filter(x => !hubCollaboratorsForHubOnChain.map(x => x.account.collaborator.toBase58()).includes(x));
    for await (let removedCollaborator of removedCollaborators) {
      try {
        const collaboratorRecord = await Account.query().findOne({publicKey: removedCollaborator});
        if (collaboratorRecord) {
          await Hub.relatedQuery('collaborators').for(hub.id).unrelate().where('accountId', collaboratorRecord.id);
          console.log('Removed Collaborator from Hub:', collaboratorRecord.publicKey, hub.publicKey);
        }
      } catch (err) {
        console.log(err);
      }
    }
  
    //Update HubPosts  
    const hubPostsForHubOnChain = hubPosts.hubPostsForHubOnChain
    const hubPostsForHubDb = hubPosts.hubPostsForHubDb
    const newHubPostsForHub = hubPosts.newHubPostsForHub

    for await (let hubPost of hubPostsForHubOnChain) {
      try {
        if (hubPostsForHubDb.includes(hubPost.account.post.toBase58())) {
          const hubContent = hubContents.filter(x => x.account.child.toBase58() === hubPost.publicKey.toBase58())[0]
          if (!hubContent.account.visible) {
            const post = await Post.query().findOne({publicKey: hubPost.account.post.toBase58()});
            if (post) {
              await Post.relatedQuery('releases').for(post.id).unrelate().where('hubId', hub.id);
              console.log('Deleted Post:', hubPost.publicKey);
            }
          }  
        }
      } catch (err) {
        console.log(err);
      }
    }

    for await (let hubPost of newHubPostsForHub) {
      try {
        const hubContent = hubContents.filter(x => x.account.child.toBase58() === hubPost.publicKey.toBase58())[0]
        const post = await Post.query().findOne({publicKey: hubPost.account.post.toBase58()});
        if (hubContent.account.visible) {
          if (post) {
            await Hub.relatedQuery('posts').for(hub.id).relate({
              id: post.id,
              hubPostPublicKey: hubPost.publicKey.toBase58(),
            });
            if (hubContent.account.publishedThroughHub) {
              await post.$query().patch({hubId: hub.id});
            }
            console.log('Related Post to Hub:', post.publicKey, hub.publicKey);
          }
          
          if (hubPost.account.referenceContent) {
            const release = await Release.query().findOne({publicKey: hubPost.account.referenceContent.toBase58()});
            if (release && post) {
              const relatedRelease = await Post.relatedQuery('releases').for(post.id).where('releaseId', release.id).first();
              if (!relatedRelease) {
                await Post.relatedQuery('releases').for(post.id).relate(release.id);
                console.log('Related Release to Post:', release.publicKey, post.publicKey);
              }
            }
          }
        } else if (post) {
          if (hubContent.account.publishedThroughHub) {
            await Post.query().deleteById(post.id);
            console.log('deleted Post:', post.publicKey);
          }
  
        }
      } catch (err) {
        console.log(err);
      }
    }
  }
}

const processor = new NinaProcessor();
export default processor;