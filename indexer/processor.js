const anchor = require('@project-serum/anchor');
const { Metaplex } = require('@metaplex-foundation/js');
const axios = require('axios');
const Account = require('./db/models/Account');
const Exchange = require('./db/models/Exchange');
const Hub = require('./db/models/Hub');
const Post = require('./db/models/Post');
const Release = require('./db/models/Release');
const { decode } = require('./utils');

const blacklist = [
  'BpZ5zoBehKfKUL2eSFd3SNLXmXHi4vtuV4U6WxJB3qvt',
  'FNZbs4pdxKiaCNPVgMiPQrpzSJzyfGrocxejs8uBWnf',
]

class NinaProcessor {
  constructor() {
    this.provider = null;
    this.program = null;
    this.metaplex = null;
    this.latestSignature = null;
  }

  async init() {
    const connection = new anchor.web3.Connection(process.env.SOLANA_CLUSTER_URL);
    this.provider = new anchor.AnchorProvider(connection, {}, {commitment: 'processed'})  
    this.program = await anchor.Program.at(
      process.env.NINA_PROGRAM_ID,
      this.provider,
    )
    this.metaplex = new Metaplex(connection);
  }

  async runDbProcesses() {
    await this.processReleases();
    await this.processExchanges();
    await this.processPosts();
    await this.processHubs();
  }

  async processExchanges() {
    const signatures = await this.getSignatures(this.provider.connection, this.latestSignature, this.latestSignature === null)
    const pages = []
    const size = 150
    for (let i = 0; i < signatures.length; i += size) {
      pages.push(signatures.slice(i, i + size))
    }
    const exchangeInits = []
    const exchangeCancels = []
    const completedExchanges = []
    const coder = new anchor.BorshInstructionCoder(this.program.idl)
    for await (let page of pages) {
      const txIds = page.map(signature => signature.signature)
      const txs = await this.provider.connection.getParsedTransactions(txIds)
      for await (let tx of txs) {
        if (tx) {
          const length = tx.transaction.message.instructions.length
          const accounts = tx.transaction.message.instructions[length - 1].accounts
          if (accounts) {
            if (accounts.length === 13) {
              const mintPublicKey = tx.transaction.message.instructions[length - 1].accounts[1]
              try {
                await this.provider.connection.getTokenSupply(mintPublicKey)
                const config = coder.decode(tx.transaction.message.instructions[length - 1].data, 'base58').data.config
                exchangeInits.push({
                  expectedAmount: config.isSelling ? config.expectedAmount.toNumber() / 1000000 : 1,
                  initializerAmount: config.isSelling ? 1 : config.initializerAmount.toNumber() / 1000000,
                  publicKey: tx.transaction.message.instructions[length - 1].accounts[5].toBase58(),
                  release: tx.transaction.message.instructions[length - 1].accounts[9].toBase58(),
                  isSale: config.isSelling,
                  initializer: tx.transaction.message.instructions[length - 1].accounts[0].toBase58(),
                  createdAt: new Date(tx.blockTime * 1000).toISOString()
                })
                console.log('found an exchange init',tx.transaction.message.instructions[length - 1].accounts[5].toBase58())
              } catch (error) {
                console.log('not a mint: ', mintPublicKey.toBase58())
              }
            } else if (accounts.length === 6) {
              exchangeCancels.push({
                publicKey: tx.transaction.message.instructions[length - 1].accounts[2].toBase58(),
                updatedAt: new Date(tx.blockTime * 1000).toISOString()
              })
              console.log('found an exchange cancel', tx.transaction.message.instructions[length - 1].accounts[2].toBase58())
            } else if (accounts.length === 16) {
              completedExchanges.push({
                publicKey: tx.transaction.message.instructions[length - 1].accounts[2].toBase58(),
                legacyExchangePublicKey: tx.transaction.message.instructions[length - 1].accounts[7].toBase58(),
                completedBy: tx.transaction.message.instructions[length - 1].accounts[0].toBase58(),
                updatedAt: new Date(tx.blockTime * 1000).toISOString()
              })
              console.log('found an exchange completed', tx.transaction.message.instructions[length - 1].accounts[2].toBase58())
            }
          }
        }
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
  }

  async processReleases() {
    // Get all releases that are not on the blacklist
    const releases = (await this.program.account.release.all()).filter(x => !blacklist.includes(x.publicKey.toBase58()));
    
    const metadataAccounts = (
      await this.metaplex.nfts()
        .findAllByMintList(
          releases.map(
            release => release.account.releaseMint
          )
        )
        .run()
    ).filter(x => x);

    const existingReleases = await Release.query();

    const allMints = metadataAccounts.map(x => x.mintAddress.toBase58());
    const newMints = allMints.filter(x => !existingReleases.find(y => y.mint === x));
    const newMetadata = metadataAccounts.filter(x => newMints.includes(x.mintAddress.toBase58()));
    const newReleasesWithMetadata = releases.filter(x => newMints.includes(x.account.releaseMint.toBase58()));
    
    const newMetadataJson = await axios.all(
      newMetadata.map(metadata => axios.get(metadata.uri))
    ).then(axios.spread((...responses) => responses))

    for await (let release of newReleasesWithMetadata) {
      try {
        const metadata = metadataAccounts.find(x => x.mintAddress.toBase58() === release.account.releaseMint.toBase58());
        const metadataJson = newMetadataJson.find(x => x.config.url === metadata.uri).data;
  
        let publisher = await Account.findOrCreate(release.account.authority.toBase58());
  
        const releaseRecord = await Release.query().insertGraph({
          publicKey: release.publicKey.toBase58(),
          mint: release.account.releaseMint.toBase58(),
          metadata: metadataJson,
          datetime: new Date(release.account.releaseDatetime.toNumber() * 1000).toISOString(),
          publisherId: publisher.id,
        })
        await Release.processRevenueShares(release, releaseRecord);
        console.log('Inserted Release:', release.publicKey.toBase58());
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
  }
  
  async processPosts() {
    const hubContents = await this.program.account.hubContent.all();
    const hubPosts = await this.program.account.hubPost.all();
    const posts = await this.program.account.post.all();
    const existingPosts = await Post.query();
    const newPosts = posts.filter(x => !existingPosts.find(y => y.publicKey === x.publicKey.toBase58()));

    const newPostsJson = await axios.all(
      newPosts.map(post => axios.get(decode(post.account.uri)))
    ).then(axios.spread((...responses) => responses))

    for await (let newPost of newPosts) {
      try {
        const hubPost = hubPosts.find(x => x.account.post.toBase58() === newPost.publicKey.toBase58());
        const hubContent = hubContents.filter(x => x.account.child.toBase58() === hubPost.publicKey.toBase58())[0];
        if (hubContent.account.visible) {
          const publisher = await Account.findOrCreate(newPost.account.author.toBase58());
          await Post.query().insertGraph({
            publicKey: newPost.publicKey.toBase58(),
            data: newPostsJson.find(x => x.config.url === decode(newPost.account.uri)).data,
            datetime: new Date(newPost.account.createdAt.toNumber() * 1000).toISOString(),
            publisherId: publisher.id,
          })
          console.log('Inserted Post:', newPost.publicKey.toBase58());
        }
      } catch (err) {
        console.log(err);
      }
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
      await Hub.updateHub(existingHub, hubContent, hubReleases, hubCollaborators, hubPosts);
    }
    
    let newHubs = hubs.filter(x => !existingHubs.find(y => y.publicKey === x.publicKey.toBase58()));
    newHubs.forEach(hub => {
      hub.account.uri = decode(hub.account.uri);
    })
    newHubs = newHubs.filter(hub => hub.account.uri.indexOf("arweave.net") > -1)

    const newHubsJson = await axios.all(
      newHubs.map(hub => axios.get(hub.account.uri))
    ).then(axios.spread((...responses) => responses))

    for await (let newHub of newHubs) {
      try {
        const data = newHubsJson.find(x => x.config.url === newHub.account.uri).data
        let authority = await Account.findOrCreate(newHub.account.authority.toBase58());
        const hub = await Hub.query().insertGraph({
          publicKey: newHub.publicKey.toBase58(),
          handle: decode(newHub.account.handle),
          data,
          datetime: new Date(newHub.account.datetime.toNumber() * 1000).toISOString(),
          authorityId: authority.id,
        });
        console.log('Inserted Hub:', newHub.publicKey.toBase58());
        await Hub.updateHub(hub, hubContent, hubReleases, hubCollaborators, hubPosts);
      } catch (err) {
        console.log(err);
      }
    }
  }

  async processCollectors() {
    const releases = (await this.program.account.release.all()).filter(x => !blacklist.includes(x.publicKey.toBase58()));
    const exchanges = await this.program.account.exchange.all();

    const metadataAccounts = (
      await this.metaplex.nfts()
        .findAllByMintList(
          releases.map(
            release => release.account.releaseMint
          )
        )
        .run()
    ).filter(x => x);

    for await (let metadata of metadataAccounts) {
      try {
        const release = releases.filter(x => x.account.releaseMint.toBase58() === metadata.mintAddress.toBase58())[0];
        const releaseInDb = await Release.query().findOne({publicKey: release.publicKey.toBase58()});
        const existingCollectorsInDb = await releaseInDb
          .$relatedQuery('collectors')
          .select('accountId', 'publicKey')
        
          let tokenAccountsForRelease = await this.provider.connection.getParsedProgramAccounts(
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
            let response = await this.provider.connection.getTokenAccountBalance(tokenAccount.pubkey, this.provider.connection.commitment)
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
    const options = {}
    if (tx && isBefore) {
      options.before = tx.signature
    } else if (!isBefore && tx) {
      options.until = tx.signature
    }
    const newSignatures = await connection.getConfirmedSignaturesForAddress2(new anchor.web3.PublicKey(process.env.NINA_PROGRAM_ID), options)
    newSignatures.forEach(x => {
      if (!this.latestSignature || x.blockTime > this.latestSignature.blockTime) {
        this.latestSignature = x
        console.log('New Latest Signature:', this.latestSignature.blockTime)
      }
    })
    let signature
    if (isBefore) {
      signature = newSignatures.reduce((a, b) => a.blockTime < b.blockTime ? a : b)  
    } else {
      signature = tx.signature  
    }
    existingSignatures.push(...newSignatures)
    if (existingSignatures.length % 1000 === 0) {
      return await this.getSignatures(connection, signature, isBefore, existingSignatures)
    }
    return existingSignatures
  }
  
}

module.exports = new NinaProcessor();