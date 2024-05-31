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
  Tag,
  Transaction,
  Verification,
} from '@nina-protocol/nina-db';
import { NameRegistryState, getNameAccountKey, getHashedName } from "@bonfida/spl-name-service";
import { decode, uriExtractor, fetchFromArweave } from './utils.js';
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
import { parse } from 'dotenv';

const MAX_PARSED_TRANSACTIONS = 50
const MAX_TRANSACTION_SIGNATURES = 1000

const CACHE_RESET_TIME = 1200000 // 20 minutes

const DISPATCHER_ADDRESS = 'BnhxwsrY5aaeMehsTRoJzX2X4w5sKMhMfBs2MCKUqMC'
const FILE_SERVICE_ADDRESS = '3skAZNf7EjUus6VNNgHog44JZFsp8BBaso9pBRgYntSd'
export const blacklist = [
  'BpZ5zoBehKfKUL2eSFd3SNLXmXHi4vtuV4U6WxJB3qvt',
  'FNZbs4pdxKiaCNPVgMiPQrpzSJzyfGrocxejs8uBWnf',
  'AWNbGaKQLLtwZ7Dn9tFwD1ZiqotSQf41zHWkfq2v2CBx',
  '7pZffbxcgGFNW1oM5DJ7w7k3zNdHuQHzQC96srsFd14W',
  '5bbtHxL8rhNxGvEbBQhEJnBci98GdrebYyrTa7KEGgsE',
  '69nbYBjCpaC5NAPsQuLVGrJ6PWXThGmhpU4ftQQU9FNw',
  'ECkyVBzbEgpU6BmwUBEcqwceepzdsRrW9LHSrnVj6gRU',
  'C81ZghJq4JitQBmNx1EbGBAn5cECAEBw31cxNs4CNuuT',
  '9neh36BD2DTmU6Ln9L7KjCz5r4Tx9T2iegRJKujv8MYg', //duhsa
  'Gv3kCB228w2mwc2uYuU4xka9rr5ia9vfoGYWvD9qKy3o', // shreddies new age
  '8cz3KyHRmSjyjjtjGa3Uo3JqLoLuj4UFpmeqPWeh9Z2m', // drs everything must go
  '5nh1UMSNBjkAHG2LGB95N3YDDdo5TNtdWJfNC5mniJrk', // gods mom 
  // 'BQfv888vV1yb3EBiELNazLphWdZkyCoQ12Wn1rDnPewN', // sv jasper
  'U6zHrdKuzSESWAagA3rHCFDrbrrykrfksFEpecbqNhD', //omar tek double
  '43qV7YR9mKYoFj5FbAGty6qLpDZWVatLzzQQmticPP2F', //mockturno
  'H49ruBocWacUQgdryuap2mt4ELGStPk21v6FoLLJqYU1', // ayla loon
  // 'GsWQccLjBVXjE46Jyt3G71s7Yqo55WupWGXFrFRbR8Vn', // ws
  // '83utqav6fN78SBS4YLr4aF51ahWLBQKhqJwePZob1esC', // heavee 
  // 'H92zsEYTHqiDK9uZWT58vsReKvtWpLuLNghadaZu8T8o' // nexcyia
  'DhNtpLHXHm61tQ2dZoCF1FUz2rdcYVZYdprKd3aT8MLp', //CLZNE may 10
  '9P2pVbci23jzScATTDYmNGDbSsz2VRisPqRgvtuPuLnG', //dp
  '72Rz4zuSwt7ThLbBtCBX7XvHtsAZGMoRHewAhg3EHVG5', //aliese
  'CcaxEGNQ8Xk8uYLiW15HVmDzuhw3WHVrJ2FwnvqbC8zK', //m&m label mix double
  'Bc66BCnVBmEUoSJ3Px59A6G4XNahddQaf2yZbnJ8SK1S',
  '3pa2makZMzqA2XnRd55ZwVowopSMdn5sVAGNHZwedSJq',
  '6g9DeEeVnXFdba1xBqtzrHUZZqsB6ifJrBkjviZTCfho',
  'EqeAmeH2E7yH9gexLu1j9gtsPuCsfKRJ92e83EEJB63r',
  '9maki6Sx6xPiNcofauXpdqwRfNG1av1vFYcZtm5TrMcU',
  '5JaUdyAevoEUJY1bscGPHMxtXQxab4rcJLWeQUuSY6iR', // merz fri apr 19
  '8bfkDUUaT4JoLEzkiyW7mJx6hECrwZg4hKiasvVATyTH', // furtado may 3
  // '5vFhRng1KaKbWnpnGMuyF49YXXqGxeNFdn9q8Bc9jkUi', // lara june 7
  'EoZTcZBrSEWgvgC2CiDbyApu1fY8uKeQuKQe3jo8LveG', // taraneh new age prayer double
  // '6AyQ7vDhEHX8eiEHKcqEq6tD8wVfjcAeeup5zNm8D2TU', // rxk may 31
  'GitWVdeCFQMDAubKcK8iyFgeMBKkRtYxQDCz8qCA15zh', //jhnny dup
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
    this.isProcessing = false;
    this.isProcessingTransactions = false;
  }

  async init() {
    const connection = new anchor.web3.Connection(process.env.SOLANA_CLUSTER_URL);
    this.provider = new anchor.AnchorProvider(connection, {}, {commitment: 'processed'})  
    const tokenIndexConnection = new anchor.web3.Connection(process.env.SOLANA_CLUSTER_URL);
    this.tokenIndexProvider = new anchor.AnchorProvider(tokenIndexConnection, {commitment: 'processed'});
    this.program = await anchor.Program.at(
      process.env.NINA_PROGRAM_ID,
      this.provider,
    )
    this.metaplex = new Metaplex(connection);
  }

  async runDbProcesses() {
    if (!this.isProcessing) {
      console.log(`${new Date()} Running DB processes`)
      this.isProcessing = true;

      try {
        console.log(`${new Date()} Running processReleases()`)
        await this.processReleases();
        console.log(`${new Date()} Completed processReleases()`)

        console.log(`${new Date()} Running processPosts()`)
        await this.processPosts();
        console.log(`${new Date()} Completed processPosts()`)

        console.log(`${new Date()} Running processHubs()`)
        await this.processHubs();
        console.log(`${new Date()} Completed processHubs()`)

        console.log(`${new Date()} Running processSubscriptions()`)
        await this.processSubscriptions();
        console.log(`${new Date()} Completed processSubscriptions()`)

        console.log(`${new Date()} Running processVerifications()`)
        await this.processVerifications();
        console.log(`${new Date()} Completed processVerifications()`)
      } catch (error) {
        console.log(`${new Date()} Error running DB processes: ${error}`)
      }

      this.isProcessing = false;
    } else {
      console.log(`${new Date()} DB processes already running`)
    }
  }

  async runProcessExchangesAndTransactions (isInitialRun = false) {
    try {
      if (!this.isProcessingTransactions) {
        this.isProcessingTransactions = true;
        console.log(`${new Date()} Running processExchangesAndTransactions()`)
        await this.processExchangesAndTransactions(isInitialRun);
        this.isProcessingTransactions = false;
        console.log(`${new Date()} Completed processExchangesAndTransactions()`) 
      } else {
        console.log(`${new Date()} processExchangesAndTransactions() already running`)
      } 
    } catch (error) {
      console.log(`${new Date()} Error running processExchangesAndTransactions: ${error}`)
      this.isProcessingTransactions = false;
    }
  }

  async processVerifications() {
    try {
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

  async processExchangesAndTransactions(isInitialRun = false) {
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
        const txs = await this.provider.connection.getParsedTransactions(txIds, {
          maxSupportedTransactionVersion: 0
        })
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
              if (!transactionRecord || isInitialRun) {
                await this.processTransaction(tx, txid, blocktime, accounts, transactionRecord)
              }
              if (!transactionRecord && accounts) {
                if (accounts.length === 13 || tx.meta.logMessages.some(log => log.includes('ExchangeInit'))) {
                  if (!tx.meta.logMessages.some(log => log.includes('Release'))) {
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
                      console.log('found an exchange init', accounts[5].toBase58())
                    } catch (error) {
                      console.log('error not a token mint: ', txid, error)
                    }
                  }
                } else if (accounts.length === 6 || tx.meta.logMessages.some(log => log.includes('ExchangeCancel'))) {
                  exchangeCancels.push({
                    publicKey: accounts[2].toBase58(),
                    updatedAt: datetime
                  })
                  console.log('found an exchange cancel', accounts[2].toBase58())
                } else if (accounts.length === 16 || tx.meta.logMessages.some(log => log.includes('ExchangeAccept'))) {
                  completedExchanges.push({
                    publicKey: accounts[2].toBase58(),
                    legacyExchangePublicKey: accounts[7].toBase58(),
                    completedBy: accounts[0].toBase58(),
                    updatedAt: datetime
                  })
                  console.log('found an exchange completed', accounts[2].toBase58())
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
            const release = await Release.query().findById(exchange.releaseId);
            let accountPublicKey
            if (exchange.isSale) {
              accountPublicKey = completedBy.publicKey
            } else {
              const account = await Account.query().findById(exchange.initializerId);
              accountPublicKey = account.publicKey;
            }
            await this.addCollectorForRelease(release.publicKey, accountPublicKey)
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

  isFileServicePayer(accounts) {
    return accounts[0].toBase58() === FILE_SERVICE_ADDRESS || accounts[0].toBase58() === accounts[1].toBase58()
  }

  async processTransaction(tx, txid, blocktime, accounts, transactionRecord=null) {
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
      hubPublicKey = accounts[4].toBase58()
      if (this.isFileServicePayer(accounts)) {
        accountPublicKey = accounts[18].toBase58()
      } else {
        accountPublicKey = accounts[0].toBase58()
      }
    } else if (tx.meta.logMessages.some(log => log.includes('ReleasePurchaseViaHub'))) {
      transactionObject.type = 'ReleasePurchaseViaHub'
      releasePublicKey = accounts[2].toBase58()
      accountPublicKey = accounts[1].toBase58()
      hubPublicKey = accounts[8].toBase58()
      await this.addCollectorForRelease(releasePublicKey, accountPublicKey)
    } else if (tx.meta.logMessages.some(log => log.includes('ReleasePurchase'))) {
      if (!accounts || accounts.length === 0) {
        for (let innerInstruction of tx.meta.innerInstructions) {
          for (let instruction of innerInstruction.instructions) {
            if (instruction.programId.toBase58() === 'ninaN2tm9vUkxoanvGcNApEeWiidLMM2TdBX8HoJuL4') {
              console.log('found release purchase in inner instructions (ReleasePurchaseCoinflow)')
              accounts = instruction.accounts
            }
          }
        }
      }
      transactionObject.type = 'ReleasePurchase'
      releasePublicKey = accounts[2].toBase58()
      accountPublicKey = accounts[1].toBase58()
      
      await this.addCollectorForRelease(releasePublicKey, accountPublicKey)
    } else if (tx.meta.logMessages.some(log => log.includes('HubAddCollaborator'))) {
      transactionObject.type = 'HubAddCollaborator'
      if (this.isFileServicePayer(accounts)) {
        hubPublicKey = accounts[3].toBase58()
        accountPublicKey = accounts[1].toBase58()
        toAccountPublicKey = accounts[5].toBase58()
      } else {
        hubPublicKey = accounts[2].toBase58()
        accountPublicKey = accounts[0].toBase58()
        toAccountPublicKey = accounts[4].toBase58()
      }
    } else if (tx.meta.logMessages.some(log => log.includes('HubAddRelease'))) {
      transactionObject.type = 'HubAddRelease'
      if (this.isFileServicePayer(accounts)) {
        releasePublicKey = accounts[6].toBase58()
        accountPublicKey = accounts[1].toBase58()
        hubPublicKey = accounts[2].toBase58()
      } else {
        releasePublicKey = accounts[5].toBase58()
        accountPublicKey = accounts[0].toBase58()
        hubPublicKey = accounts[1].toBase58()
      }
    } else if (tx.meta.logMessages.some(log => log.includes('PostInitViaHubWithReferenceRelease'))) {
      transactionObject.type = 'PostInitViaHubWithReferenceRelease'
      postPublicKey = accounts[2].toBase58()
      releasePublicKey = accounts[7].toBase58()
      accountPublicKey = accounts[0].toBase58()
      hubPublicKey = accounts[1].toBase58()
    } else if (tx.meta.logMessages.some(log => log.includes('PostInitViaHub'))) {
      transactionObject.type = 'PostInitViaHub'
      postPublicKey = accounts[2].toBase58()
      if (this.isFileServicePayer(accounts)) {
        accountPublicKey = accounts[8].toBase58()
      } else {
        accountPublicKey = accounts[0].toBase58()
      }
      hubPublicKey = accounts[1].toBase58()
    } else if (tx.meta.logMessages.some(log => log.includes('PostUpdateViaHubPost'))) {
      transactionObject.type = 'PostUpdateViaHubPost'
      postPublicKey = accounts[3].toBase58()
      accountPublicKey = accounts[1].toBase58()
      hubPublicKey = accounts[2].toBase58()
    } else if (tx.meta.logMessages.some(log => log.includes('SubscriptionSubscribeAccount'))) {
      transactionObject.type = 'SubscriptionSubscribeAccount'
      // By adding a PAYER account to the subscription to accomodate delegated subscriptions, 
      // we increase the accounts size from 4 to 5 and need to do the below to remain backwards compatible
      // with subscriptions created before nina v0.2.14
      if (accounts.length === 4) {
        accountPublicKey = accounts[0].toBase58()
        toAccountPublicKey = accounts[2].toBase58()
      } else {
        accountPublicKey = accounts[1].toBase58()
        toAccountPublicKey = accounts[3].toBase58()
      }
    } else if (tx.meta.logMessages.some(log => log.includes('SubscriptionSubscribeHub'))) {
      transactionObject.type = 'SubscriptionSubscribeHub'
      // By adding a PAYER account to the subscription to accomodate delegated subscriptions, 
      // we increase the accounts size from 4 to 5 and need to do the below to remain backwards compatible
      // with subscriptions created before nina v0.2.14
      if (accounts.length === 4) {
        accountPublicKey = accounts[0].toBase58()
        toHubPublicKey = accounts[2].toBase58()
      } else {
        accountPublicKey = accounts[1].toBase58()
        toHubPublicKey = accounts[3].toBase58()
      }
    } else if (tx.meta.logMessages.some(log => log.includes('SubscriptionUnsubscribe'))) {
      transactionObject.type = 'SubscriptionUnsubscribe'
      accountPublicKey = accounts[1].toBase58()
    } else if (tx.meta.logMessages.some(log => log.includes('ReleaseClaim'))) {
      transactionObject.type = 'ReleaseClaim'
      accountPublicKey = accounts[3].toBase58()
      releasePublicKey = accounts[1].toBase58()
      await this.addCollectorForRelease(releasePublicKey, accountPublicKey)
    } else if (tx.meta.logMessages.some(log => log.includes('HubInit'))) {
      transactionObject.type = 'HubInit'
      if (this.isFileServicePayer(accounts)) {
        accountPublicKey = accounts[1].toBase58()
        hubPublicKey = accounts[2].toBase58()
      } else {
        accountPublicKey = accounts[0].toBase58()
        hubPublicKey = accounts[1].toBase58()
      }
    } else if (tx.meta.logMessages.some(log => log.includes('ReleaseInit'))) {
      transactionObject.type = 'ReleaseInit'
      accountPublicKey = accounts[4].toBase58()
      releasePublicKey = accounts[0].toBase58()
    } else if (tx.meta.logMessages.some(log => log.includes('ReleaseCloseEdition'))) {
      transactionObject.type = 'ReleaseCloseEdition'
      if (this.isFileServicePayer(accounts)) {
        accountPublicKey = accounts[1].toBase58()
        releasePublicKey = accounts[2].toBase58()
      } else {
        accountPublicKey = accounts[0].toBase58()
        releasePublicKey = accounts[1].toBase58()
      }
    } else if (tx.meta.logMessages.some(log => log.includes('HubContentToggleVisibility'))) {
      transactionObject.type = 'HubContentToggleVisibility'
      if (this.isFileServicePayer(accounts)) {
        accountPublicKey = accounts[1].toBase58()
        hubPublicKey = accounts[2].toBase58()
      } else {
        accountPublicKey = accounts[0].toBase58()
        hubPublicKey = accounts[1].toBase58()
      }
    } else if (tx.meta.logMessages.some(log => log.includes('HubRemoveCollaborator'))) {
      transactionObject.type = 'HubRemoveCollaborator'
      if (this.isFileServicePayer(accounts)) {
        accountPublicKey = accounts[1].toBase58()
        hubPublicKey = accounts[2].toBase58()
        toAccountPublicKey = accounts[4].toBase58()
      } else {
        accountPublicKey = accounts[0].toBase58()
        hubPublicKey = accounts[1].toBase58()
        toAccountPublicKey = accounts[3].toBase58()
      }
    } else if (tx.meta.logMessages.some(log => log.includes('HubUpdateCollaboratorPermissions'))) {
      transactionObject.type = 'HubUpdateCollaboratorPermissions'
      if (this.isFileServicePayer(accounts)) {
        accountPublicKey = accounts[1].toBase58()
        hubPublicKey = accounts[3].toBase58()
        toAccountPublicKey = accounts[5].toBase58()
      } else {
        accountPublicKey = accounts[0].toBase58()
        hubPublicKey = accounts[2].toBase58()
        toAccountPublicKey = accounts[4].toBase58()
      }
    } else if (tx.meta.logMessages.some(log => log.includes('HubUpdateConfig'))) {
      transactionObject.type = 'HubUpdateConfig'
      if (this.isFileServicePayer(accounts)) {
        accountPublicKey = accounts[1].toBase58()
        hubPublicKey = accounts[2].toBase58()
      } else {
        accountPublicKey = accounts[0].toBase58()
        hubPublicKey = accounts[1].toBase58()
      }
    } else if (tx.meta.logMessages.some(log => log.includes('ReleaseRevenueShareCollectViaHub'))) {
      transactionObject.type = 'ReleaseRevenueShareCollectViaHub'
      if (this.isFileServicePayer(accounts)) {
        accountPublicKey = accounts[1].toBase58()
        releasePublicKey = accounts[3].toBase58()
        hubPublicKey = accounts[6].toBase58()
      } else {
        accountPublicKey = accounts[0].toBase58()
        releasePublicKey = accounts[2].toBase58()
        hubPublicKey = accounts[5].toBase58()
      }
    } else if (tx.meta.logMessages.some(log => log.includes('ReleaseRevenueShareCollect'))) {
      transactionObject.type = 'ReleaseRevenueShareCollect'
      if (this.isFileServicePayer(accounts)) {
        accountPublicKey = accounts[1].toBase58()
        releasePublicKey = accounts[5].toBase58()
      } else {
        accountPublicKey = accounts[0].toBase58()
        releasePublicKey = accounts[4].toBase58()
      }
    } else if (tx.meta.logMessages.some(log => log.includes('ReleaseRevenueShareTransfer'))) {
      transactionObject.type = 'ReleaseRevenueShareTransfer'
      if (this.isFileServicePayer(accounts)) {
        accountPublicKey = accounts[1].toBase58()
        releasePublicKey = accounts[5].toBase58()
      } else {
        accountPublicKey = accounts[0].toBase58()
        releasePublicKey = accounts[4].toBase58()
      }
    } else if (tx.meta.logMessages.some(log => log.includes('ReleaseUpdateMetadata'))) {
      transactionObject.type = 'ReleaseUpdateMetadata'
      if (this.isFileServicePayer(accounts)) {
        accountPublicKey = accounts[1].toBase58()
        releasePublicKey = accounts[2].toBase58()
      } else {
        accountPublicKey = accounts[0].toBase58()
        releasePublicKey = accounts[1].toBase58()
      }

      const metaplex = new Metaplex(this.provider.connection);
      const releaseAccount = await this.program.account.release.fetch(new anchor.web3.PublicKey(releasePublicKey), 'confirmed')
      let metadataAccount = (await metaplex.nfts().findAllByMintList({mints: [releaseAccount.releaseMint]}, { commitment: 'confirmed' }))[0];
      let json
      try {
        json = (await axios.get(metadataAccount.uri)).data
      } catch (error) {
        json = (await axios.get(metadataAccount.uri.replace('arweave.net', 'ar-io.net'))).data
      }
      const release = await Release.query().findOne({ publicKey: releasePublicKey })
      const tagsBefore = await release.$relatedQuery('tags')
      const newTags = json.properties.tags.filter(tag => !tagsBefore.find(t => t.value === tag))
      const deletedTags = tagsBefore.filter(tag => !json.properties.tags.find(t => t === tag.value))
      await release.$query().patch({
        metadata: json,
      })
      for await (let tag of newTags) {
        const tagRecord = await Tag.findOrCreate(tag);
        await Release.relatedQuery('tags').for(release.id).relate(tagRecord.id);
      }
      for await (let tag of deletedTags) {
        const tagRecord = await Tag.findOrCreate(tag.value);
        await Release.relatedQuery('tags').for(release.id).unrelate().where('tagId', tagRecord.id);
      }
    } else if (tx.meta.logMessages.some(log => log.includes('ExchangeInit'))) {
      transactionObject.type = 'ExchangeInit'
      accountPublicKey = accounts[0].toBase58()
      releasePublicKey = accounts[9].toBase58()
    } else if (tx.meta.logMessages.some(log => log.includes('ExchangeCancel'))) {
      transactionObject.type = 'ExchangeCancel'
      accountPublicKey = accounts[0].toBase58()
    } else if (tx.meta.logMessages.some(log => log.includes('ExchangeAccept'))) {
      transactionObject.type = 'ExchangeAccept'
      accountPublicKey = accounts[0].toBase58()
      if (accounts.length === 16) {
        releasePublicKey = accounts[12].toBase58()
      } else if (accounts.length === 14) {
        releasePublicKey = accounts[10].toBase58()
      }
    } else if (tx.meta.logMessages.some(log => log.includes('HubWithdraw'))) {
      transactionObject.type = 'HubWithdraw'
      if (this.isFileServicePayer(accounts)) {
        accountPublicKey = accounts[1].toBase58()
        hubPublicKey = accounts[2].toBase58()
      } else {
        accountPublicKey = accounts[0].toBase58()
        hubPublicKey = accounts[1].toBase58()
      }
    } else if (accounts?.length === 10) {
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
    } else {
      transactionObject.type = 'Unknown'
      accountPublicKey = tx.transaction.message.accountKeys[0].pubkey.toBase58()
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

      // The previous way we were handling callbacks for subscriptions was not properly handling
      // deleteing unsubscribes, so we need to do that here
      // if someone subscribes and unsubscribes a bunch this is still safe, bc it should 
      // add and delete as needed until it lands on the final state
      // and txs are processed in blocktime order, so we should always land on the final state
      if (transactionObject.type === 'SubscriptionUnsubscribe') {
        await Subscription.query().delete().where('publicKey', accounts[2].toBase58())
      }

      // Note: madjestic kasuals releases didnt have a hubId set in their db.Release record,
      // looked into it and noticed that their hubContent.publishedThroughHub was set to false
      // no idea why that was the case, via the api they all return the correct hub as publishedThroughHub
      // don't know how that is getting set either - hunted around for reason for both and cant find any
      // IT IS A MYSTERY
      // but it is also TRUE that any tx.type === 'ReleaseInitViaHub' should have a hubId set
      // so we can just set it here
      if (transactionObject.type === 'ReleaseInitViaHub') {
        const release = await Release.query().findOne({ publicKey: releasePublicKey })
        const hub = await Hub.query().findOne({ publicKey: hubPublicKey })
        await release.$query().patch({ hubId: hub.id })
        await Hub.relatedQuery('releases').for(hub.id).patch({
          visible: true,
        }).where( {id: release.id });
      }
      if (transactionRecord) {
        await transactionRecord.$query().patch(transactionObject)
      } else {
        await Transaction.query().insertGraph(transactionObject)
      }
    }
  }

  async processReleases() {
    // Get all releases that are not on the blacklist
    try {
      const releases = (await this.program.account.release.all()).filter(x => !blacklist.includes(x.publicKey.toBase58()));
      const releaseMints = releases.map(x => x.account.releaseMint)
      const metadataAccounts = (await this.metaplex.nfts().findAllByMintList({mints: releaseMints})).filter(x => x);
      const existingReleases = await Release.query();

      console.log(`${new Date()} processReleases - ${releases.length}`)

      const allMints = metadataAccounts.map(x => x.mintAddress.toBase58());
      const newMints = allMints.filter(x => !existingReleases.find(y => y.mint === x));
      const newReleasesWithMetadata = releases.filter(x => newMints.includes(x.account.releaseMint.toBase58()));
  
      for await (let release of newReleasesWithMetadata) {
        try {
          const metadata = metadataAccounts.find(x => x.mintAddress.toBase58() === release.account.releaseMint.toBase58());
          const metadataJson = await fetchFromArweave(metadata.uri);
          let publisher = await Account.findOrCreate(release.account.authority.toBase58());
    
          this.warmCache(metadataJson.image);

          await Release.createRelease({
            publicKey: release.publicKey.toBase58(),
            mint: release.account.releaseMint.toBase58(),
            metadata: metadataJson,
            datetime: new Date(release.account.releaseDatetime.toNumber() * 1000).toISOString(),
            publisherId: publisher.id,
            releaseAccount: release
          })
          console.log(`Instered Release: ${release.publicKey.toBase58()}`)
        } catch (err) {
          console.log(`${new Date()} processReleases - error creating release ${release.publicKey.toBase58()}: ${err}`);
        }
      }
  
      for await (let releaseRecord of existingReleases) {
        try {
          const release = releases.find(x => x.publicKey.toBase58() === releaseRecord.publicKey);
          if (release) {
            await Release.processRevenueShares(release, releaseRecord);
            if (!releaseRecord.slug) {
              const slug = await Release.generateSlug(releaseRecord.metadata)
              releaseRecord = Release.query().patchAndFetchById(releaseRecord.id, {
                slug
              })
            }
            if (!releaseRecord.price) {
              releaseRecord = await Release.query().patchAndFetchById(releaseRecord.id, {
                price: `${release.account.price.toNumber()}`,
              })
            }
            if (!releaseRecord.paymentMint) {
              releaseRecord = await Release.query().patchAndFetchById(releaseRecord.id, {
                paymentMint: release.account.paymentMint.toBase58(),
              })
            }
            const tags = await releaseRecord.$relatedQuery('tags');
            if (tags.length === 0 && releaseRecord.metadata.properties.tags?.length > 0) {
              for await (let tag of releaseRecord.metadata.properties.tags) {
                const tagRecord = await Tag.findOrCreate(tag);
                await Release.relatedQuery('tags').for(releaseRecord.id).relate(tagRecord.id);
              }
            }
          }
          // If release.createdAt is newer than 20 minutes, reset the image cache
          if (Date.parse(releaseRecord.datetime) > (Date.now() - CACHE_RESET_TIME)) {
            this.warmCache(releaseRecord.metadata.image);
          }
        } catch (error) {
          console.log(`${new Date()} processReleases - error Release.processRevenueShares existingReleases ${releaseRecord.publicKey}: ${error}`);
        }
      }
    } catch (error) {
      console.log(`${new Date()} error processing releases: ${error}`)
    }
  }
  
  async processPosts() {
    try {
      const hubContents = await this.program.account.hubContent.all();
      const hubPosts = await this.program.account.hubPost.all();
      const posts = await this.program.account.post.all();
      const existingPosts = await Post.query();
      const newPosts = posts.filter(x => !existingPosts.find(y => y.publicKey === x.publicKey.toBase58()));
      for await (let existingPost of existingPosts) {
        if (existingPost.version === '0.0.1' || existingPost.version === '0.0.0') {
          await this.upgradePostsToV2(existingPost);
        }

        if (Date.parse(existingPost.datetime ) > (Date.now() - CACHE_RESET_TIME)) {
          this.warmCache(existingPost.data.heroImage);
          existingPost.data.blocks.forEach(block => {
            if (block.type === 'image') {
              this.warmCache(block.data.image);
            }
          })
        }
    }
      for await (let newPost of newPosts) {
        try {
          if (blacklist.includes(newPost.publicKey.toBase58())) {
            continue;
          }
          const hubPost = hubPosts.find(x => x.account.post.toBase58() === newPost.publicKey.toBase58());
          const hubContent = hubContents.filter(x => x.account.child.toBase58() === hubPost.publicKey.toBase58())[0];
          const data = await fetchFromArweave(decode(newPost.account.uri).replace('}', ''));
          if (hubContent.account.visible) {
            const publisher = await Account.findOrCreate(newPost.account.author.toBase58());
            const post = await Post.query().insertGraph({
              publicKey: newPost.publicKey.toBase58(),
              data: data,
              datetime: new Date(newPost.account.createdAt.toNumber() * 1000).toISOString(),
              publisherId: publisher.id,
              version: data.blocks ? '0.0.2' : '0.0.1'
            })
            if (data.blocks) {
              for await (let block of data.blocks) {
                switch (block.type) {
                  case 'image':
                    this.warmCache(block.data.image);
                    break;

                  case 'release':
                    for await (let release of block.data) {
                      try {
                        const releaseRecord = await Release.query().findOne({ publicKey: release.publicKey });
                        await Post.relatedQuery('releases').for(post.id).relate(releaseRecord.id);
                      } catch (error) {
                        console.log('error processing release: ', error)
                      }
                    }
                    break;

                  case 'featuredRelease':
                    try {
                      const releaseRecord = await Release.query().findOne({ publicKey: block.data });
                      await Post.relatedQuery('releases').for(post.id).relate(releaseRecord.id);
                    } catch (error) {
                      console.log('error processing featuredRelease: ', error)
                    }
                    break
                    
                  default:
                    break
                }
              }
            }
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

  async upgradePostsToV2(post) {
    const data = { ...post.data }
    if (!post.data.slug) {
      let slug = post.data.title
      if (data.title.length > 200) {
        slug = data.title.substring(0, 200)
      }

      slug = slug
        .normalize('NFKD')
        .replace(/[\u0300-\u036F]/g, '') // remove accents and convert to closest ascii equivalent
        .toLowerCase() // convert to lowercase
        .replace('-', '') // remove hyphens
        .replace(/  +/g, ' ') // remove spaces
        .replace(/ /g, '-') // replace spaces with hyphens
        .replace(/[^a-zA-Z0-9-]/g, '') // remove non-alphanumeric characters
        .replace(/--+/g, '') // remove spaces
        .replace(/-$/, '') // remove trailing hyphens
      
      const checkIfSlugIsValid = async (slug) => {
        try {
          console.log('slug.length', slug.length)
          if (slug.length === 0) {
            slug = `${Math.floor(Math.random() * 1000000)}`
          }
          console.log('slug after', slug)
          const postForSlug = await this.http.get(`/posts/${slug}`)
          if (postForSlug) {
            slug = `${slug}-${Math.floor(Math.random() * 1000000)}`
          }
          const postForNewSlug = await this.http.get(`/posts/${slug}`)
          if (postForNewSlug) {
            await checkIfSlugIsValid(slug)
          }
          return slug
        } catch (error) {
          // console.log('error', error)
          return slug
        }
      } 
      
      slug = await checkIfSlugIsValid(slug)
      data.slug = slug
    }
    if (post.publishedThroughHub) {
      data.hub = post.publishedThroughHub
    }
    if (!data.blocks) {
      let blocks = []
      const block = {
        type: 'richText',
        index: 0,
        data: data.body
      }
      blocks.push(block)
      if (data.reference) {
        const releaseRecord = await Release.query().findOne({ publicKey: data.reference })
        data.heroImage = releaseRecord.metadata.image
        const releaseBlock = {
          type: 'featuredRelease',
          index: 1,
          data: data.reference
        }
        blocks.push(releaseBlock)
      } else {
        data.heroImage = ''
      }
      data.blocks = blocks
      data.date = Date.parse(post.datetime)
    }
    await Post.query().patchAndFetchById(post.id, { data })
  }
  
  async processHubs() {
    try {
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
    
      for await (let newHub of newHubs) {
        try {
          const data = await fetchFromArweave(newHub.account.uri);
          let authority = await Account.findOrCreate(newHub.account.authority.toBase58());
          const hub = await Hub.query().insertGraph({
            publicKey: newHub.publicKey.toBase58(),
            handle: decode(newHub.account.handle),
            data,
            dataUri: newHub.account.uri,
            datetime: new Date(newHub.account.datetime.toNumber() * 1000).toISOString(),
            updatedAt: new Date(newHub.account.datetime.toNumber() * 1000).toISOString(),
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
    } catch (error) {
      console.log(`${new Date()} - Error processing hubs: ${error}`)
    }
  }

  async processSubscriptions() {
    try {
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
    } catch (error) {
      console.log(`${new Date()} - Error processing subscriptions: ${error}`)
    }
  }

  async processCollectors() {
    try {
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
    } catch (error) {
      console.log(`${new Date()} - Error processing collectors: ${error}`)
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
        dataUri: hubAccount.account.uri,
        updatedAt: new Date().toISOString(),
      });
    }

    try {
      if (hub.updatedAt) {
        // If hub.updatedAt is newer than 20 minutes, reset the image cache
        if (Date.parse(hub.updatedAt) > (Date.now() - CACHE_RESET_TIME)) {
          this.warmCache(hub.data.image);
        }
      }
    } catch (error) {
      console.log('Error updating hub image cache', error)
    }

    // Update Hub Releases
    const hubReleasesForHubOnChain = hubReleases.hubReleasesForHubOnChain;
    const hubReleasesForHubDb = hubReleases.hubReleasesForHubDb;
    const newHubReleasesForHub = hubReleases.newHubReleasesForHub;
  
    for await (let hubRelease of hubReleasesForHubOnChain) {
      try {
        if (hubReleasesForHubDb.includes(hubRelease.account.release.toBase58())) {
          const hubContent = hubContents.filter(x => x.account.child.toBase58() === hubRelease.publicKey.toBase58())
          const release = await Release.query().findOne({publicKey: hubRelease.account.release.toBase58()});
          if (!release.hubId && hub.authorityId === release.publisherId) {
            await release.$query().patch({hubId: hub.id});
          }
          if (release) {
            let visible = false;
            hubContent.forEach(hc => {
              if (!visible) {
                if (hc.account.visible) {
                  visible = true;
                }
              }
            })
            await Hub.relatedQuery('releases').for(hub.id).patch({
              visible,
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

  async warmCache(image, delay=1000) {
    try {
      const handleWarmCache = async (image) => {
        if (process.env.IMGIX_API_KEY) {
          await new Promise(r => setTimeout(r, delay));
          try {
            await axios.post('https://api.imgix.com/api/v1/purge', {
              data: {
                attributes: {
                  url: `${process.env.IMGIX_SOURCE_DOMAIN}/${encodeURIComponent(image)}`
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
}

const processor = new NinaProcessor();
export default processor;