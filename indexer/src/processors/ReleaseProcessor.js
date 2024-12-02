import { BaseProcessor } from './base/BaseProcessor.js';
import { Account, Hub, Release, Tag } from '@nina-protocol/nina-db';
import { logTimestampedMessage } from '../utils/logging.js';
import { decode, fetchFromArweave } from '../utils/index.js';
import * as anchor from '@project-serum/anchor';

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
  
    async initialize() {
      if (!this.program) {
        const connection = new anchor.web3.Connection(process.env.SOLANA_CLUSTER_URL);
        const provider = new anchor.AnchorProvider(connection, {}, { commitment: 'processed' });
        this.program = await anchor.Program.at(process.env.NINA_PROGRAM_ID, provider);
      }
    }
    canProcessTransaction(type) {
      return this.RELEASE_TRANSACTION_TYPES.has(type);
    }

    async processReleaseTags(releaseId, tags, releasePublicKey) {
      try {
        for (const tag of tags) {
          const tagRecord = await Tag.findOrCreate(tag);
          await Release.relatedQuery('tags')
            .for(releaseId)
            .relate(tagRecord.id);
          logTimestampedMessage(`Added tag ${tag} to release ${releasePublicKey}`);
        }
      } catch (error) {
        logTimestampedMessage(`Error processing tags: ${error.message}`);
      }
    }

    async processRevenueShares(release, releaseAccount) {
      try {
        const royaltyRecipients = releaseAccount.account?.royaltyRecipients || releaseAccount.royaltyRecipients;
        for (const recipient of royaltyRecipients) {
          try {
            const recipientPublicKey = recipient.recipientAuthority.toBase58();
            if (recipientPublicKey !== "11111111111111111111111111111111") {
              const recipientAccount = await Account.findOrCreate(recipientPublicKey);
              const revenueShares = (await recipientAccount.$relatedQuery('revenueShares')).map(revenueShare => revenueShare.id);

              const percentShare = recipient.percentShare.toNumber();
              if (!revenueShares.includes(release.id) && percentShare > 0) {
                await Account.relatedQuery('revenueShares')
                  .for(recipientAccount.id)
                  .relate(release.id);
                logTimestampedMessage(`Added revenue share for ${recipientPublicKey} on release ${release.publicKey}`);
              } else if (revenueShares.includes(release.id) && percentShare === 0) {
                await Account.relatedQuery('revenueShares')
                  .for(recipientAccount.id)
                  .unrelate()
                  .where('id', release.id);
                logTimestampedMessage(`Removed revenue share for ${recipientPublicKey} on release ${release.publicKey}`);
              }
            }
          } catch (error) {
            logTimestampedMessage(`Error processing individual royalty recipient: ${error.message}`);
          }
        }
      } catch (error) {
        logTimestampedMessage(`Error processing revenue shares: ${error.message}`);
      }
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
                const releaseAccount = await this.program.account.release.fetch(
                  new anchor.web3.PublicKey(releasePublicKey),
                  'confirmed'
                );

                const json = await fetchFromArweave(decode(releaseAccount.uri));

                // Process tags if they exist
                if (json.properties && json.properties.tags) {
                  await this.processReleaseTags(release.id, json.properties.tags, releasePublicKey);
                }

                await this.updateTransactionReferences(transaction, {
                  releaseId: release.id
                });

                logTimestampedMessage(`Successfully processed ReleaseInit ${txid} for release ${releasePublicKey}`);
              }
            } catch (error) {
              logTimestampedMessage(`Error processing ReleaseInit for ${txid}: ${error.message}`);
            }
            break;
          }

          case 'ReleaseClaim': {
            try {
              const releasePublicKey = accounts[1].toBase58();
              const collectorPublicKey = accounts[3].toBase58();

              // Ensure the release exists
              const release = await Release.query().findOne({ publicKey: releasePublicKey });
              if (!release) {
                logTimestampedMessage(`Release not found for ReleaseClaim ${txid} with publicKey ${releasePublicKey}`);
                return;
              }

              // Create or find the collector account
              const collector = await Account.findOrCreate(collectorPublicKey);

              // Add collector to release's collectors
              await Release.relatedQuery('collectors')
                .for(release.id)
                .relate(collector.id)
                .onConflict(['releaseId', 'accountId'])
                .ignore();

              // Update transaction references
              await this.updateTransactionReferences(transaction, {
                releaseId: release.id
              });

              logTimestampedMessage(`Successfully processed ReleaseClaim ${txid} for release ${releasePublicKey} claimed by ${collectorPublicKey}`);
            } catch (error) {
              logTimestampedMessage(`Error processing ReleaseClaim for ${txid}: ${error.message}`);
            }
            break;
          }

          case 'ReleasePurchase': {
            try {
              // Handle both standard and special case account layouts
              let releasePublicKey;
              let collectorPublicKey;

              if (accounts.length === 10) {
                // Special case handling
                if (accounts[0].toBase58() === accounts[1].toBase58()) {
                  releasePublicKey = accounts[2].toBase58();
                  collectorPublicKey = accounts[0].toBase58();
                } else if (accounts[3].toBase58() === accounts[4].toBase58()) {
                  releasePublicKey = accounts[0].toBase58();
                  collectorPublicKey = accounts[3].toBase58();
                } else {
                  releasePublicKey = accounts[2].toBase58();
                  collectorPublicKey = accounts[1].toBase58();
                }
              } else {
                // Standard case
                releasePublicKey = accounts[2].toBase58();
                collectorPublicKey = accounts[1].toBase58();
              }

              // Ensure the release exists
              const release = await Release.query().findOne({ publicKey: releasePublicKey });
              if (!release) {
                logTimestampedMessage(`Release not found for ReleasePurchase ${txid} with publicKey ${releasePublicKey}`);
                return;
              }

              // Add collector relationship
              const collector = await Account.findOrCreate(collectorPublicKey);

              // Add collector to release's collectors
              await Release.relatedQuery('collectors')
                .for(release.id)
                .relate(collector.id)
                .onConflict(['releaseId', 'accountId'])
                .ignore();

              // Update transaction references
              await this.updateTransactionReferences(transaction, {
                releaseId: release.id
              });

              logTimestampedMessage(`Successfully processed ReleasePurchase ${txid} for release ${releasePublicKey}`);
            } catch (error) {
              logTimestampedMessage(`Error processing ReleasePurchase for ${txid}: ${error.message}`);
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
                const releaseAccount = await this.program.account.release.fetch(
                  new anchor.web3.PublicKey(releasePublicKey),
                  'confirmed'
                );

                const json = await fetchFromArweave(decode(releaseAccount.uri));

                // Process tags if they exist
                if (json.properties && json.properties.tags) {
                  await this.processReleaseTags(release.id, json.properties.tags, releasePublicKey);
                }

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
          case 'ReleaseRevenueShareCollect': {
            try {
              const releasePublicKey = this.isFileServicePayer(accounts) ?
                accounts[5].toBase58() : accounts[4].toBase58();

              const release = await Release.query().findOne({ publicKey: releasePublicKey });
              if (!release) {
                logTimestampedMessage(`Release not found for ReleaseRevenueShareCollect ${txid} with publicKey ${releasePublicKey}`);
                return;
              }

              const releaseAccount = await this.program.account.release.fetch(
                new anchor.web3.PublicKey(releasePublicKey),
                'confirmed'
              );

              if (!releaseAccount) {
                logTimestampedMessage(`Release account not found on-chain for ${releasePublicKey}`);
                return;
              }

              await this.processRevenueShares(release, releaseAccount);

              await this.updateTransactionReferences(transaction, {
                releaseId: release.id
              });

              logTimestampedMessage(`Successfully processed ReleaseRevenueShareCollect ${txid} for release ${releasePublicKey}`);
            } catch (error) {
              logTimestampedMessage(`Error processing ReleaseRevenueShareCollect for ${txid}: ${error.message}`);
            }
            break;
          }
          case 'ReleaseRevenueShareCollectViaHub': {
            try {
              const releasePublicKey = this.isFileServicePayer(accounts) ?
                accounts[3].toBase58() : accounts[2].toBase58();

              const hubPublicKey = this.isFileServicePayer(accounts) ?
                accounts[6].toBase58() : accounts[5].toBase58();

              const release = await Release.query().findOne({ publicKey: releasePublicKey });
              if (!release) {
                logTimestampedMessage(`Release not found for ReleaseRevenueShareCollectViaHub ${txid} with publicKey ${releasePublicKey}`);
                return;
              }

              const hub = await Hub.query().findOne({ publicKey: hubPublicKey });
              if (!hub) {
                logTimestampedMessage(`Hub not found for ReleaseRevenueShareCollectViaHub ${txid} with publicKey ${hubPublicKey}`);
                return;
              }
              const releaseAccount = await this.program.account.release.fetch(
                new anchor.web3.PublicKey(releasePublicKey),
                'confirmed'
              );

              if (!releaseAccount) {
                logTimestampedMessage(`Release account not found on-chain for ${releasePublicKey}`);
                return;
              }

              await this.processRevenueShares(release, releaseAccount);

              await this.updateTransactionReferences(transaction, {
                releaseId: release.id,
                hubId: hub.id
              });

              logTimestampedMessage(`Successfully processed ReleaseRevenueShareCollectViaHub ${txid} for release ${releasePublicKey} via hub ${hubPublicKey}`);
            } catch (error) {
              logTimestampedMessage(`Error processing ReleaseRevenueShareCollectViaHub for ${txid}: ${error.message}`);
            }
            break;
          }
          case 'ReleaseRevenueShareTransfer': {
            try {
              const releasePublicKey = this.isFileServicePayer(accounts) ?
                accounts[5].toBase58() : accounts[4].toBase58();

              const release = await Release.query().findOne({ publicKey: releasePublicKey });
              if (!release) {
                logTimestampedMessage(`Release not found for ReleaseRevenueShareTransfer ${txid} with publicKey ${releasePublicKey}`);
                return;
              }

              const releaseAccount = await this.program.account.release.fetch(
                new anchor.web3.PublicKey(releasePublicKey),
                'confirmed'
              );

              if (!releaseAccount) {
                logTimestampedMessage(`Release account not found on-chain for ${releasePublicKey}`);
                return;
              }

              await this.processRevenueShares(release, releaseAccount);

              await this.updateTransactionReferences(transaction, {
                releaseId: release.id
              });

              logTimestampedMessage(`Successfully processed ReleaseRevenueShareTransfer ${txid} for release ${releasePublicKey}`);
            } catch (error) {
              logTimestampedMessage(`Error processing ReleaseRevenueShareTransfer for ${txid}: ${error.message}`);
            }
            break;
          }
          case 'ReleaseUpdateMetadata': {
            try {
              const releasePublicKey = this.isFileServicePayer(accounts) ?
                accounts[2].toBase58() : accounts[1].toBase58();

              const release = await Release.query().findOne({ publicKey: releasePublicKey });
              if (!release) {
                logTimestampedMessage(`Release not found for ReleaseUpdateMetadata ${txid} with publicKey ${releasePublicKey}`);
                return;
              }

              // Get the release account and metadata from chain
              const releaseAccount = await this.program.account.release.fetch(
                new anchor.web3.PublicKey(releasePublicKey),
                'confirmed'
              );

              // Fetch metadata JSON using fetchFromArweave utility
              const json = await fetchFromArweave(decode(releaseAccount.uri));

              // Process tags
              const tagsBefore = await release.$relatedQuery('tags');
              const newTags = json.properties.tags.filter(tag =>
                !tagsBefore.find(t => t.value === tag)
              );
              const deletedTags = tagsBefore.filter(tag =>
                !json.properties.tags.find(t => t === tag.value)
              );

              // Update release metadata
              await release.$query().patch({
                metadata: json,
              });

              // Add new tags
              for (const tag of newTags) {
                const tagRecord = await Tag.findOrCreate(tag);
                await Release.relatedQuery('tags')
                  .for(release.id)
                  .relate(tagRecord.id);
                logTimestampedMessage(`Added tag ${tag} to release ${releasePublicKey}`);
              }

              // Remove deleted tags
              for (const tag of deletedTags) {
                const tagRecord = await Tag.findOrCreate(tag.value);
                await Release.relatedQuery('tags')
                  .for(release.id)
                  .unrelate()
                  .where('tagId', tagRecord.id);
                logTimestampedMessage(`Removed tag ${tag.value} from release ${releasePublicKey}`);
              }

              // Update transaction references
              await this.updateTransactionReferences(transaction, {
                releaseId: release.id
              });

              logTimestampedMessage(`Successfully processed ReleaseUpdateMetadata ${txid} for release ${releasePublicKey}`);
            } catch (error) {
              logTimestampedMessage(`Error processing ReleaseUpdateMetadata for ${txid}: ${error.message}`);
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