import { BaseProcessor } from './base/BaseProcessor.js';
import { Account, Hub, Release } from '@nina-protocol/nina-db';
import { logTimestampedMessage } from '../utils/logging.js';

export class ReleaseProcessor extends BaseProcessor {
    constructor() {
      super();
      this.RELEASE_TRANSACTION_TYPES = new Set([
        'ReleaseInitWithCredit',
        'ReleaseInitViaHub',
        'ReleasePurchaseViaHub',
        'ReleasePurchase',
        'ReleaseClaim',
        'ReleaseInit',
        'ReleaseCloseEdition',
        'ReleaseUpdateMetadata',
        'ReleaseRevenueShareCollectViaHub',
        'ReleaseRevenueShareCollect',
        'ReleaseRevenueShareTransfer'
      ]);
    }
  
    canProcessTransaction(type) {
      return this.RELEASE_TRANSACTION_TYPES.has(type);
    }
  
    async processTransaction(txid) {
      try {
        const txData = await this.processTransactionRecord(txid);
        if (!txData) return;

        const { transaction, accounts, txInfo } = txData;

        if (!this.canProcessTransaction(transaction.type)) {
          return;
        }

        // Verify authority exists
        const authority = await Account.query().findById(transaction.authorityId);
        if (!authority) {
          logTimestampedMessage(`Authority not found for transaction ${txid} with id ${transaction.authorityId}`);
          return;
        }

        // Process based on transaction type
        switch (transaction.type) {
          case 'ReleaseInitWithCredit':
          case 'ReleaseInit': {
            try {
              const releasePublicKey = accounts[0].toBase58();
              const release = await Release.findOrCreate(releasePublicKey);
              if (release) {
                await this.updateTransactionReferences(transaction, {
                  releaseId: release.id
                });
              }
            } catch (error) {
              logTimestampedMessage(`Error processing ReleaseInit for ${txid}: ${error.message}`);
            }
            break;
          }

          case 'ReleasePurchaseViaHub': {
            try {
              const releasePublicKey = accounts[2].toBase58();
              const hubPublicKey = accounts[8].toBase58();

              // Ensure the release exists
              const release = await Release.query().findOne({ publicKey: releasePublicKey });
              if (!release) {
                logTimestampedMessage(`Release not found for ReleasePurchaseViaHub ${txid} with publicKey ${releasePublicKey}`);
                return;
              }

              // Ensure the hub exists
              const hub = await Hub.query().findOne({ publicKey: hubPublicKey });
              if (!hub) {
                logTimestampedMessage(`Hub not found for ReleasePurchaseViaHub ${txid} with publicKey ${hubPublicKey}`);
                return;
              }

              // Add collector relationship
              const collectorPublicKey = accounts[1].toBase58();
              const collector = await Account.findOrCreate(collectorPublicKey);

              // Add collector to release's collectors
              await Release.relatedQuery('collectors')
                .for(release.id)
                .relate(collector.id)
                .onConflict(['releaseId', 'accountId'])
                .ignore();

              // Update transaction references
              await this.updateTransactionReferences(transaction, {
                releaseId: release.id,
                hubId: hub.id
              });

              logTimestampedMessage(`Successfully processed ReleasePurchaseViaHub ${txid} for release ${releasePublicKey} and hub ${hubPublicKey}`);
            } catch (error) {
              logTimestampedMessage(`Error processing ReleasePurchaseViaHub for ${txid}: ${error.message}`);
            }
            break;
          }

          case 'ReleaseInitViaHub': {
            try {
              const releasePublicKey = accounts[1].toBase58();
              const hubPublicKey = accounts[4].toBase58();

              // First ensure hub exists
              const hub = await Hub.query().findOne({ publicKey: hubPublicKey });
              if (!hub) {
                logTimestampedMessage(`Hub not found for ReleaseInitViaHub ${txid} with publicKey ${hubPublicKey}`);
                return;
              }

              // Create or find release with hub reference
              let release = await Release.query().findOne({ publicKey: releasePublicKey });
              if (release) {
                // Update existing release with hub reference if needed
                if (!release.hubId) {
                  await Release.query()
                    .patch({ hubId: hub.id })
                    .where('id', release.id);
                }
              } else {
                // Create new release with hub reference
                release = await Release.findOrCreate(releasePublicKey, hubPublicKey);
              }

              if (release) {
                await this.updateTransactionReferences(transaction, {
                  releaseId: release.id,
                  hubId: hub.id
                });

                // Double check hub relationship was established
                await Hub.relatedQuery('releases')
                  .for(hub.id)
                  .relate({
                    id: release.id,
                    visible: true,
                    hubReleasePublicKey: `${hub.publicKey}-${release.publicKey}`
                  });

                logTimestampedMessage(`Successfully processed ReleaseInitViaHub ${txid} for release ${releasePublicKey} and hub ${hubPublicKey}`);
              }
            } catch (error) {
              logTimestampedMessage(`Error processing ReleaseInitViaHub for ${txid}: ${error.message}`);
            }
            break;
          }
        }
      } catch (error) {
        logTimestampedMessage(`Error in processTransaction for ${txid}: ${error.message}`);
      }
    }
}

export const releaseProcessor = new ReleaseProcessor();