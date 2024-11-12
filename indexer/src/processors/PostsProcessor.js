import { BaseProcessor } from './base/BaseProcessor.js';
import { Account, Hub, Post, Release } from '@nina-protocol/nina-db';
import { logTimestampedMessage } from '../utils/logging.js';
import { decode, fetchFromArweave } from '../utils/index.js';

export class PostsProcessor extends BaseProcessor {
    constructor() {
      super();
      this.POST_TRANSACTION_TYPES = new Set([
        'PostInitViaHubWithReferenceRelease',
        'PostInitViaHub',
        'PostUpdateViaHubPost'
      ]);
    }
  
    canProcessTransaction(type) {
      return this.POST_TRANSACTION_TYPES.has(type);
    }

    async processReferenceReleases(post, releasePublicKeys) {
      try {
        for (const releasePublicKey of releasePublicKeys) {
          const release = await Release.query().findOne({ publicKey: releasePublicKey });
          if (release) {
            const relatedRelease = await Post.relatedQuery('releases')
              .for(post.id)
              .where('releaseId', release.id)
              .first();
            
            if (!relatedRelease) {
              await Post.relatedQuery('releases').for(post.id).relate(release.id);
              logTimestampedMessage(`Related Release ${releasePublicKey} to Post ${post.publicKey}`);
            }
          }
        }
      } catch (error) {
        logTimestampedMessage(`Error processing reference releases: ${error.message}`);
      }
    }

    async processPostData(uri, publisher, hubId = null) {
      try {
        const data = await fetchFromArweave(decode(uri).replace('}', ''));
        
        // Prepare post data with version check
        const version = data.blocks ? '0.0.2' : '0.0.1';
        
        const postData = {
          data,
          datetime: new Date().toISOString(),
          publisherId: publisher.id,
          version,
          hubId
        };

        return postData;
      } catch (error) {
        logTimestampedMessage(`Error processing post data: ${error.message}`);
        throw error;
      }
    }

    async processTransaction(txid) {
      const txData = await this.processTransactionRecord(txid);
      if (!txData) return;

      const { transaction, accounts, txInfo } = txData;
      
      if (!this.canProcessTransaction(transaction.type)) {
        return;
      }

      const authority = await Account.query().findById(transaction.authorityId);
      if (!authority) {
        logTimestampedMessage(`Authority not found for transaction ${txid}`);
        return;
      }

      try {
        switch (transaction.type) {
          case 'PostInitViaHubWithReferenceRelease': {
            const postPublicKey = accounts[2].toBase58();
            const releasePublicKey = accounts[7].toBase58();
            const hubPublicKey = accounts[1].toBase58();
            
            const hub = await Hub.query().findOne({ publicKey: hubPublicKey });
            if (!hub) {
              logTimestampedMessage(`Hub not found for PostInitViaHubWithReferenceRelease ${txid}`);
              return;
            }

            // Get post data from program
            const postAccount = await this.program.account.post.fetch(
              new anchor.web3.PublicKey(postPublicKey)
            );

            const postData = await this.processPostData(postAccount.uri, authority, hub.id);
            
            // Create post
            const post = await Post.query().insertGraph({
              publicKey: postPublicKey,
              ...postData
            });

            // Process releases if post has blocks
            if (post.data.blocks) {
              const releasePublicKeys = [];
              
              // Collect release public keys from blocks
              for (const block of post.data.blocks) {
                if (block.type === 'release') {
                  releasePublicKeys.push(...block.data.map(release => release.publicKey));
                } else if (block.type === 'featuredRelease' && block.data) {
                  releasePublicKeys.push(block.data);
                }
              }

              await this.processReferenceReleases(post, releasePublicKeys);
            }

            // Add referenced release if provided
            if (releasePublicKey) {
              await this.processReferenceReleases(post, [releasePublicKey]);
            }

            // Update transaction reference
            await this.updateTransactionReferences(transaction, {
              postId: post.id,
              hubId: hub.id
            });

            break;
          }

          case 'PostInitViaHub': {
            const postPublicKey = accounts[2].toBase58();
            const hubPublicKey = accounts[1].toBase58();
            
            const hub = await Hub.query().findOne({ publicKey: hubPublicKey });
            if (!hub) {
              logTimestampedMessage(`Hub not found for PostInitViaHub ${txid}`);
              return;
            }

            // Get post data from program
            const postAccount = await this.program.account.post.fetch(
              new anchor.web3.PublicKey(postPublicKey)
            );

            const postData = await this.processPostData(postAccount.uri, authority, hub.id);
            
            // Create post
            const post = await Post.query().insertGraph({
              publicKey: postPublicKey,
              ...postData
            });

            // Process releases if post has blocks
            if (post.data.blocks) {
              const releasePublicKeys = [];
              
              for (const block of post.data.blocks) {
                if (block.type === 'release') {
                  releasePublicKeys.push(...block.data.map(release => release.publicKey));
                } else if (block.type === 'featuredRelease' && block.data) {
                  releasePublicKeys.push(block.data);
                }
              }

              await this.processReferenceReleases(post, releasePublicKeys);
            }

            // Update transaction reference
            await this.updateTransactionReferences(transaction, {
              postId: post.id,
              hubId: hub.id
            });

            break;
          }

          case 'PostUpdateViaHubPost': {
            const postPublicKey = accounts[3].toBase58();
            const hubPublicKey = accounts[2].toBase58();
            
            const post = await Post.query().findOne({ publicKey: postPublicKey });
            const hub = await Hub.query().findOne({ publicKey: hubPublicKey });
            
            if (!post || !hub) {
              logTimestampedMessage(`Post or Hub not found for PostUpdateViaHubPost ${txid}`);
              return;
            }

            // Get updated post data
            const postAccount = await this.program.account.post.fetch(
              new anchor.web3.PublicKey(postPublicKey)
            );

            const postData = await this.processPostData(postAccount.uri, authority, hub.id);
            
            // Update post
            await Post.query()
              .patch(postData)
              .where('id', post.id);

            // Update transaction reference
            await this.updateTransactionReferences(transaction, {
              postId: post.id,
              hubId: hub.id
            });

            break;
          }
        }
      } catch (error) {
        logTimestampedMessage(`Error processing post transaction ${txid}: ${error.message}`);
      }
    }
}

export const postsProcessor = new PostsProcessor();
