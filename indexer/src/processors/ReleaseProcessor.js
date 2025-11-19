import { BaseProcessor } from './base/BaseProcessor.js';
import { Account, Hub, Release, Tag } from '@nina-protocol/nina-db';
import { logTimestampedMessage } from '../utils/logging.js';
import { fetchFromArweave } from '../utils/index.js';
import * as anchor from '@project-serum/anchor';
import { hubDataService } from '../services/hubData.js';
import { Metaplex } from '@metaplex-foundation/js';
import { releaseDataService } from '../services/releaseData.js';
import { getTokenMetadata } from '@solana/spl-token';

export class ReleaseProcessor extends BaseProcessor {
    constructor() {
      super();
      this.RELEASE_TRANSACTION_TYPES = new Set([
        // program v2
        'ReleaseInitAndPurchase',
        'ReleaseInitV2',
        'ReleaseUpdate',
        'ReleaseUpdateMetaplex',
        // program v1
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

    async initialize(program, programV2) {
      super.initialize(program, programV2);
      this.metaplex = new Metaplex(program.provider.connection);
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

    async processTransaction(task) {
      try {
        const { transaction, txid, accounts, txInfo, programId } = task;
        console.log('programId', programId)
        if (!this.canProcessTransaction(transaction.type)) return;

        // Verify authority exists
        const authority = await Account.query().findById(transaction.authorityId);
        if (!authority) {
          logTimestampedMessage(`Authority not found for transaction ${txid} with id ${transaction.authorityId}`);
          return { success: false };
        }

        // Process based on transaction type
        switch (transaction.type) {
          case 'ReleaseInitAndPurchase':
            try {
              const releasePublicKey = accounts[3].toBase58();
              const release = await Release.query().findOne({ solanaAddress: releasePublicKey });
              if (!release) {
                logTimestampedMessage(`Release not found for ReleaseInitAndPurchase ${txid} with publicKey ${releasePublicKey}`);
                return;
              }

              const collectorPublicKey = accounts[1].toBase58();
              const collector = await Account.query().findOne({ publicKey: collectorPublicKey });
              if (!collector) {
                logTimestampedMessage(`Collector not found for ReleaseInitAndPurchase ${txid} with publicKey ${collectorPublicKey}`);
                return;
              }

              // Add collector to release's collectors
              await Release.relatedQuery('collectors')
                .for(release.id)
                .relate(collector.id)
                .onConflict(['releaseId', 'accountId'])
                .ignore();

              return { success: true, ids: { releaseId: release.id } };
            } catch (error) {
              logTimestampedMessage(`Error processing ReleaseInitAndPurchase for ${txid}: ${error.message}`);
              return { success: false };
            }

          case 'ReleaseInitV2':
            try {
              let releasePublicKey = accounts[2].toBase58();
              const release = await Release.findOrCreate(releasePublicKey, null, programId);
              if (release) {
                logTimestampedMessage(`Successfully processed ReleaseInitV2 ${txid} for release ${releasePublicKey}`);
                return {success: true, ids: { releaseId: release.id }};
              } else {
                logTimestampedMessage(`Release not found for ReleaseInitV2 ${txid} with publicKey ${releasePublicKey}`);
              }
            } catch (error) {
              logTimestampedMessage(`Error processing ReleaseInitV2 for ${txid}: ${error.message}`);
              return { success: false };
            }
            break;

          case 'ReleaseInitWithCredit':
            try {
              let releasePublicKey;
              if (txInfo?.meta.logMessages?.some(log => log.includes('ReleaseInitWithCredit'))) {
                try {
                  const release = await releaseDataService.fetchReleaseAccountData(accounts[1]);
                  if (release) {
                    console.log(`found release at index 1: ${accounts[1].toBase58()}`);
                    releasePublicKey = accounts[1].toBase58();
                  }
                } catch (error) {
                  console.log('Error fetching release for ReleaseInitWithCredit at index 1, trying index 2');
                  try {
                    const release = await releaseDataService.fetchReleaseAccountData(accounts[2]);
                    if (release) {
                      console.log(`found release at index 2: ${accounts[2].toBase58()}`);
                      releasePublicKey = accounts[2].toBase58();
                    }
                  } catch (error) {
                    console.log('Error fetching release for ReleaseInitWithCredit at index 2, trying index 4');
                    try {
                      const release = await releaseDataService.fetchReleaseAccountData(accounts[4]);
                      if (release) {
                        console.log(`found release at index 4: ${accounts[4].toBase58()}`);
                        releasePublicKey = accounts[4].toBase58();
                      }
                    } catch (error) {
                      try {
                        const release = await releaseDataService.fetchReleaseAccountData(accounts[0]);
                        if (release) {
                          console.log(`found release at index 0: ${accounts[0].toBase58()}`);
                          releasePublicKey = accounts[0].toBase58();
                        }
                      } catch (error) {
                        logTimestampedMessage(`Error fetching release for ReleaseInitWithCredit ${txid}: ${error.message}`);
                      }
                    }
                  }
                }
              } else if (accounts.length === 14) {
                releasePublicKey = accounts[0].toBase58();
              } else if (accounts.length === 16) {
                releasePublicKey = accounts[5].toBase58();
              } else if (accounts.length === 18) {
                releasePublicKey = accounts[7].toBase58();
              } else if (accounts.length === 13) {        
                let release;
                try {
                  release = await releaseDataService.fetchReleaseAccountData(accounts[0])
                  if (release) {
                    releasePublicKey = accounts[0].toBase58();
                  }
                } catch (error) {
                  logTimestampedMessage(`Error fetching release for ReleaseInitWithCredit ${txid}: ${error.message}`);
                  return { success: false };
                }
              }
              const release = await Release.findOrCreate(releasePublicKey, null, programId);
              if (release) {
                logTimestampedMessage(`Successfully processed ReleaseInitWithCredit ${txid} for release ${releasePublicKey}`);
                return {success: true, ids: { releaseId: release.id }};
              } else {
                logTimestampedMessage(`Release not found for ReleaseInitWithCredit ${txid} with publicKey ${releasePublicKey}`);
              }
            } catch (error) {
              logTimestampedMessage(`Error processing ReleaseInitWithCredit for ${txid}: ${error.message}`);
              return { success: false };
            }
            break;

          case 'ReleaseInit': {
            try {
              const releasePublicKey = accounts[0].toBase58();
              const release = await Release.findOrCreate(releasePublicKey, null, programId);
              if (release) {
                logTimestampedMessage(`Successfully processed ReleaseInit ${txid} for release ${releasePublicKey}`);
                return {success: true, ids: { releaseId: release.id }};
              }
            } catch (error) {
              logTimestampedMessage(`Error processing ReleaseInit for ${txid}: ${error.message}`);
              return { success: false };
            }
            break
          }

          case 'ReleaseClaim': {
            try {
              let releasePublicKey
              let collectorPublicKey
              if (programId === process.env.NINA_PROGRAM_ID) {
                releasePublicKey = accounts[1].toBase58();
                collectorPublicKey = accounts[3].toBase58();
              } else {
                releasePublicKey = accounts[2].toBase58();
                collectorPublicKey = accounts[1].toBase58();
              }

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

              logTimestampedMessage(`Successfully processed ReleaseClaim ${txid} for release ${releasePublicKey} claimed by ${collectorPublicKey}`);
              return {success:true, ids: { releaseId: release.id }};
            } catch (error) {
              logTimestampedMessage(`Error processing ReleaseClaim for ${txid}: ${error.message}`);
              return { success: false };
            }
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
              const release = await Release.query().findOne({ solanaAddress: releasePublicKey });
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

              logTimestampedMessage(`Successfully processed ReleasePurchase ${txid} for release ${releasePublicKey}`);
              return {success: true, ids: { releaseId: release.id }};
            } catch (error) {
              logTimestampedMessage(`Error processing ReleasePurchase for ${txid}: ${error.message}`);
              return {success: false};
            }
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

              logTimestampedMessage(`Successfully processed ReleasePurchaseViaHub ${txid} for release ${releasePublicKey} and hub ${hubPublicKey}`);
              return {success: true, ids: { releaseId: release.id, hubId: hub.id }};
            } catch (error) {
              logTimestampedMessage(`Error processing ReleasePurchaseViaHub for ${txid}: ${error.message}`);
              return {success: false};
            }
          }

          case 'ReleaseInitViaHub': {
            try {
              let releasePublicKey;
              let hubPublicKey;
              try {
                const release = await releaseDataService.fetchReleaseAccountData(accounts[1]);
                if (release) {
                  releasePublicKey = accounts[1].toBase58();
                  hubPublicKey = accounts[4].toBase58();
                }
              } catch (error) {
                try {
                  console.log('Error fetching release for ReleaseInitViaHub at index 1, trying index 4');
                  const release = await releaseDataService.fetchReleaseAccountData(accounts[4]);
                  if (release) {
                    releasePublicKey = accounts[4].toBase58();
                    hubPublicKey = accounts[10].toBase58();
                  }
                } catch (error) {
                  console.log('Error fetching release for ReleaseInitViaHub at index 4, trying index 5');
                  try {
                    const release = await releaseDataService.fetchReleaseAccountData(accounts[5]);
                    if (release) {
                      releasePublicKey = accounts[5].toBase58();
                      hubPublicKey = accounts[15].toBase58();
                    }
                  } catch (error) {
                    console.log(`Error fetching release for ReleaseInitViaHub at index 5, trying index 10 ${error.message}`);
                  }
                }
              }

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
                release = await Release.findOrCreate(releasePublicKey, hubPublicKey, programId);
              }

              if (release) {
                const hubReleasePublicKey = await hubDataService.buildHubReleasePublicKey(hubPublicKey, releasePublicKey);
                // Double check hub relationship was established
                await Hub.relatedQuery('releases')
                  .for(hub.id)
                  .relate({
                    id: release.id,
                    visible: true,
                    hubReleasePublicKey,
                  })
                  .onConflict(['releaseId', 'hubId'])
                  .ignore();
                  
                logTimestampedMessage(`Successfully processed ReleaseInitViaHub ${txid} for release ${releasePublicKey} and hub ${hubPublicKey}`);
                return {success: true, ids: { releaseId: release.id, hubId: hub.id }};
              }
            } catch (error) {
              logTimestampedMessage(`Error processing ReleaseInitViaHub for ${txid}: ${error.message}`);
              return {success: false};
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

              logTimestampedMessage(`Successfully processed ReleaseRevenueShareCollect ${txid} for release ${releasePublicKey}`);
              return {success: true, ids: { releaseId: release.id }};
            } catch (error) {
              logTimestampedMessage(`Error processing ReleaseRevenueShareCollect for ${txid}: ${error.message}`);
              return {success: false};
            }
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

              logTimestampedMessage(`Successfully processed ReleaseRevenueShareCollectViaHub ${txid} for release ${releasePublicKey} via hub ${hubPublicKey}`);
              return {success: true, ids: { releaseId: release.id, hubId: hub.id }};
            } catch (error) {
              logTimestampedMessage(`Error processing ReleaseRevenueShareCollectViaHub for ${txid}: ${error.message}`);
              return { success: false };
            }
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

              logTimestampedMessage(`Successfully processed ReleaseRevenueShareTransfer ${txid} for release ${releasePublicKey}`);
              return {success: true, ids: { releaseId: release.id }};
            } catch (error) {
              logTimestampedMessage(`Error processing ReleaseRevenueShareTransfer for ${txid}: ${error.message}`);
              return { success: false };
            }
          }
          case 'ReleaseUpdateMetaplex': {
            try {
              console.log('ReleaseUpdateMetaplex')
              const releasePublicKey = this.isFileServicePayer(accounts) ? accounts[2].toBase58() : accounts[1].toBase58()
              console.log('releasePublicKey', releasePublicKey)
              let release = await Release.query().findOne({publicKey: releasePublicKey})
              console.log('release 1st try', release)
              if (!release) {
                console.log('no release - finding by release.solanaAddress', releasePublicKey)
                release = await Release.query().findOne({solanaAddress: releasePublicKey})
              }
              console.log('release 2nd try', release)
              if (!release) {
                throw new Error(`Release not found ReleaseUpdateMetaplex for ${txid}: releasePublicKey: ${releasePublicKey}`)
              }

              const releaseAccount = await this.programV2.account.releaseV2.fetch(
                new anchor.web3.PublicKey(release.solanaAddress),
                'confirmed'
              )
              let metadataAccount = (await this.metaplex.nfts().findAllByMintList({mints: [releaseAccount.mint]}, { commitment: 'confirmed' }))[0];

              // Fetch metadata JSON using fetchFromArweave utility
              const json = await fetchFromArweave(metadataAccount.uri);

              // Update release metadata
              await release.$query().patch({
                metadata: json,
              });

              // Process tags
              const tagsBefore = await release.$relatedQuery('tags');
              console.log('tagsBefore: ', tagsBefore);
              if (json.properties.tags) {
                const newTags = json.properties.tags.filter(tag =>
                  !tagsBefore.find(t => t.value === Tag.sanitizeValue(tag))
                );  
                console.log('newTags: ', newTags);
                // Add new tags
                for (const tag of newTags) {
                  const tagRecord = await Tag.findOrCreate(tag);
                  await Release.relatedQuery('tags')
                    .for(release.id)
                    .relate(tagRecord.id)
                    .onConflict(['tagId', 'releaseId'])
                    .ignore();
                  logTimestampedMessage(`Added tag ${tag} to release ${releasePublicKey}`);
                }
              }
              if (tagsBefore.length > 0) {
                const deletedTags = tagsBefore.filter(tag =>
                  !json.properties.tags.find(t => t === Tag.sanitizeValue(tag.value))
                );
                console.log('deletedTags: ', deletedTags);
                // Remove deleted tags
                for (const tag of deletedTags) {
                  const tagRecord = await Tag.findOrCreate(tag.value);
                  await Release.relatedQuery('tags')
                    .for(release.id)
                    .unrelate()
                    .where('tagId', tagRecord.id);
                  logTimestampedMessage(`Removed tag ${tag.value} from release ${releasePublicKey}`);
                }
              }

              logTimestampedMessage(`Successfully processed ReleaseUpdateMetadata ${txid} for release ${releasePublicKey}`);
              return {success: true, ids: { releaseId: release.id }};              
            } catch (error) {
              logTimestampedMessage(`Error processing ReleaseUpdateMetaplex for ${txid}: ${error.message}`)
              return { success: false }
            }
          }
          case 'ReleaseUpdateMetadata': {
            try {
              console.log('ReleaseUpdateMetadata✅ ')
              const releasePublicKey = this.isFileServicePayer(accounts) ?
                accounts[2].toBase58() : accounts[1].toBase58();

              const release = await Release.query().findOne({ publicKey: releasePublicKey });
              if (!release) {
                throw new Error(`Release not found for ReleaseUpdateMetadata ${txid} with publicKey ${releasePublicKey}`);
              }

              // Get the release account and metadata from chain
              const releaseAccount = await this.program.account.release.fetch(
                new anchor.web3.PublicKey(releasePublicKey),
                'confirmed'
              );
              let metadataAccount = (await this.metaplex.nfts().findAllByMintList({mints: [releaseAccount.releaseMint]}, { commitment: 'confirmed' }))[0];

              // Fetch metadata JSON using fetchFromArweave utility
              const json = await fetchFromArweave(metadataAccount.uri);

              // Update release metadata
              await release.$query().patch({
                metadata: json,
              });
              
              // Process tags
              const tagsBefore = await release.$relatedQuery('tags');
              console.log('tagsBefore: ', tagsBefore);
              if (json.properties.tags) {
                const newTags = json.properties.tags.filter(tag =>
                  !tagsBefore.find(t => t.value === Tag.sanitizeValue(tag))
                );  
                console.log('newTags: ', newTags);
                // Add new tags
                for (const tag of newTags) {
                  const tagRecord = await Tag.findOrCreate(tag);
                  await Release.relatedQuery('tags')
                    .for(release.id)
                    .relate(tagRecord.id)
                    .onConflict(['tagId', 'releaseId'])
                    .ignore();
                  logTimestampedMessage(`Added tag ${tag} to release ${releasePublicKey}`);
                }
              }
              if (tagsBefore.length > 0) {
                const deletedTags = tagsBefore.filter(tag =>
                  !json.properties.tags.find(t => t === Tag.sanitizeValue(tag.value))
                );
                console.log('deletedTags: ', deletedTags);
                // Remove deleted tags
                for (const tag of deletedTags) {
                  const tagRecord = await Tag.findOrCreate(tag.value);
                  await Release.relatedQuery('tags')
                    .for(release.id)
                    .unrelate()
                    .where('tagId', tagRecord.id);
                  logTimestampedMessage(`Removed tag ${tag.value} from release ${releasePublicKey}`);
                }
              }

              logTimestampedMessage(`Successfully processed ReleaseUpdateMetadata ${txid} for release ${releasePublicKey}`);
              return {success: true, ids: { releaseId: release.id }};
            } catch (error) {
              logTimestampedMessage(`Error processing ReleaseUpdateMetadata for ${txid}: ${error.message}`);
              return { success: false };
            }
          }

          case 'ReleaseUpdate':
            try {
              const releasePublicKey = accounts[3].toBase58();
              console.log('accounts', accounts)
              const release = await Release.query().findOne({ publicKey: releasePublicKey });
              if (!release) {
                logTimestampedMessage(`Release not found for ReleaseUpdate ${txid} with publicKey ${releasePublicKey}`);
                return { success: false };
              }
              console.log('this.programV2', this.programV2)
              const releaseAccount = await this.programV2.account.releaseV2.fetch(
                new anchor.web3.PublicKey(releasePublicKey),
                'confirmed'
              );
              if (!releaseAccount) {
                logTimestampedMessage(`Release account not found on-chain for ${releasePublicKey}`);
                return { success: false };
              }

              const metadataAccount = await getTokenMetadata(this.programV2.provider.connection, releaseAccount.mint, 'confirmed');
              const json = await fetchFromArweave(metadataAccount.uri);
              await release.$query().patch({
                metadata: json,
              });

              // Process tags with proper error handling
              try {
                const tagsBefore = await release.$relatedQuery('tags');
                console.log('tagsBefore', tagsBefore);
                if (json?.properties?.tags && Array.isArray(json.properties.tags) && json.properties.tags.length > 0) {
                  const newTags = json.properties.tags.filter(tag =>
                    tag && typeof tag === 'string' && !tagsBefore.find(t => t.value === Tag.sanitizeValue(tag))
                  );  
                  console.log('newTags: ', newTags);
                  for (const tag of newTags) {
                    try {
                      const tagRecord = await Tag.findOrCreate(tag);
                      await Release.relatedQuery('tags')
                        .for(release.id)
                        .relate(tagRecord.id)
                        .onConflict(['tagId', 'releaseId'])
                        .ignore();
                      logTimestampedMessage(`Added tag ${tag} to release ${releasePublicKey}`);
                    } catch (tagError) {
                      logTimestampedMessage(`Error adding tag ${tag} to release ${releasePublicKey}: ${tagError.message}`);
                      // Continue with other tags
                    }
                  }

                  if (tagsBefore.length > 0) {
                    const deletedTags = tagsBefore.filter(tag =>
                      !json.properties.tags.find(t => t && typeof t === 'string' && Tag.sanitizeValue(t) === Tag.sanitizeValue(tag.value))
                    );
                    console.log('deletedTags: ', deletedTags);
                    // Remove deleted tags
                    for (const tag of deletedTags) {
                      try {
                        const tagRecord = await Tag.findOrCreate(tag.value);
                        await Release.relatedQuery('tags')
                          .for(release.id)
                          .unrelate()
                          .where('tagId', tagRecord.id);
                        logTimestampedMessage(`Removed tag ${tag.value} from release ${releasePublicKey}`);
                      } catch (tagError) {
                        logTimestampedMessage(`Error removing tag ${tag.value} from release ${releasePublicKey}: ${tagError.message}`);
                        // Continue with other tags
                      }
                    }
                  }
                } else {
                  logTimestampedMessage(`No tags found in metadata for release ${releasePublicKey} (metadata.properties.tags: ${json?.properties?.tags})`);
                }
              } catch (tagsError) {
                logTimestampedMessage(`Error processing tags for ReleaseUpdate ${txid}: ${tagsError.message}`);
                // Don't fail the entire transaction if tag processing fails
              }
              logTimestampedMessage(`Successfully processed ReleaseUpdate ${txid} for release ${releasePublicKey}`);
              return {success: true, ids: { releaseId: release.id }};
            } catch (error) {
              logTimestampedMessage(`Error processing ReleaseUpdate for ${txid}: ${error.message}`);
              return { success: false };
            }
            
          case 'ReleaseCloseEdition': {
            try {
              let releasePublicKey;
              if (accounts[0].toBase58() === accounts[1].toBase58()) {
                releasePublicKey = accounts[2].toBase58();
              } else {
                releasePublicKey = accounts[1].toBase58();
              }
              const release = await Release.query().findOne({ publicKey: releasePublicKey });
              if (!release) {
                throw new Error(`Release not found for ReleaseCloseEdition ${txid} with publicKey ${releasePublicKey}`);
              }
              return {success: true, ids: { releaseId: release.id }};
            } catch (error) {
              logTimestampedMessage(`Error processing ReleaseCloseEdition for ${txid}: ${error.message}`);
              return { success: false };
            }
          }
        }
      } catch (error) {
        logTimestampedMessage(`Error in processTransaction for ${txid}: ${error.message}`);
        return { success: false };
      }

    }
}

export const releaseProcessor = new ReleaseProcessor();