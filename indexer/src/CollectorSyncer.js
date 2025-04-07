import { Connection, PublicKey } from '@solana/web3.js';
import * as anchor from '@project-serum/anchor';
import { Metaplex } from '@metaplex-foundation/js';
import axios from 'axios';
import { Account, Release } from '@nina-protocol/nina-db';
import { logTimestampedMessage } from './utils/logging.js';

class CollectorSyncer {
  constructor() {
    this.program = null;
    this.metaplex = null;
    this.connection = new Connection(process.env.SOLANA_CLUSTER_URL);
    this.programId = new PublicKey(process.env.NINA_PROGRAM_ID);
    this.provider = new anchor.AnchorProvider(this.connection, {}, { commitment: 'processed' });
    this.isSyncing = false;
  }

  async initialize() {
    this.program = await anchor.Program.at(
      this.programId,
      this.provider
    );
    this.metaplex = new Metaplex(this.connection);
  }


  async syncCollectors() {
    try {
      if (this.isSyncing) {
        logTimestampedMessage('Collector sync already in progress');
        return false;
      }
      this.isSyncing = true;

      const restrictedReleases = await axios.get(`${process.env.ID_SERVER_ENDPOINT}/restricted`);
      const restrictedReleasesPublicKeys = restrictedReleases.data.restricted.map(x => x.value);
      const releases = (await this.program.account.release.all()).filter(x => !restrictedReleasesPublicKeys.includes(x.publicKey.toBase58()));
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
    } catch (error) {
      console.log(`${new Date()} - Error processing collectors: ${error}`)
    }
    this.isSyncing = false;
    logTimestampedMessage('Collector sync finished');
  }
}

export default new CollectorSyncer();