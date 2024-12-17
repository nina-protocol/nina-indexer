import { BaseProcessor } from './base/BaseProcessor.js';
import { Account, Hub, Post, Release } from '@nina-protocol/nina-db';
import { logTimestampedMessage } from '../utils/logging.js';
import { decode, fetchFromArweave } from '../utils/index.js';
import * as anchor from '@project-serum/anchor';

export class PostsProcessor extends BaseProcessor {
    constructor() {
      super();
      this.program = null;
      this.POST_TRANSACTION_TYPES = new Set([
        'PostInitViaHubWithReferenceRelease',
        'PostInitViaHub',
        // 'PostUpdateViaHubPost'
      ]);
    }

    async initialize(program) {
      this.program = program;
    }

    canProcessTransaction(type) {
      return this.POST_TRANSACTION_TYPES.has(type);
    }

    async processPostContent(data, postId) {
      if (data.blocks) {
        for (const block of data.blocks) {
          switch (block.type) {
            case 'image':
              break;

            case 'release':
              for (const release of block.data) {
                try {
                  const releaseRecord = await Release.query().findOne({ publicKey: release.publicKey });
                  if (releaseRecord) {
                    const relatedRelease = await Post.relatedQuery('releases')
                      .for(postId)
                      .where('releaseId', releaseRecord.id)
                      .first();

                    if (!relatedRelease) {
                      await Post.relatedQuery('releases').for(postId).relate(releaseRecord.id);
                      logTimestampedMessage(`Related Release ${release.publicKey} to Post ${postId}`);
                    }
                  }
                } catch (error) {
                  logTimestampedMessage(`Error processing release in post content: ${error.message}`);
                }
              }
              break;

            case 'featuredRelease':
              try {
                const releaseRecord = await Release.query().findOne({ publicKey: block.data });
                if (releaseRecord) {
                  const relatedRelease = await Post.relatedQuery('releases')
                    .for(postId)
                    .where('releaseId', releaseRecord.id)
                    .first();

                  if (!relatedRelease) {
                    await Post.relatedQuery('releases').for(postId).relate(releaseRecord.id);
                    logTimestampedMessage(`Related Featured Release ${block.data} to Post ${postId}`);
                  }
                }
              } catch (error) {
                logTimestampedMessage(`Error processing featured release in post content: ${error.message}`);
              }
              break;
          }
        }
      }
    }

    async processTransaction(task) {      
      try {
        const { transaction, accounts, txid } = task;      
        if (!this.canProcessTransaction(transaction.type)) return;
  
        const authority = await Account.query().findById(transaction.authorityId);
        if (!authority) {
          logTimestampedMessage(`Authority not found for transaction ${txid}`);
          return;
        }
        switch (transaction.type) {
          case 'PostInitViaHubWithReferenceRelease':
          case 'PostInitViaHub': {
            try {
              const postPublicKey = accounts[2].toBase58();
              const hubPublicKey = accounts[1].toBase58();
              const releasePublicKey = transaction.type === 'PostInitViaHubWithReferenceRelease' ?
                accounts[7].toBase58() : null;
              
              let hub = await Hub.query().findOne({ publicKey: hubPublicKey });
              if (!hub) {
                logTimestampedMessage(`Hub not found for ${transaction.type} ${txid}`);
                return;
              }
  
              // Fetch post data from program
              const postAccount = await this.program.account.post.fetch(
                new anchor.web3.PublicKey(postPublicKey)
              );
  
              // Process post data
              const postData = await fetchFromArweave(decode(postAccount.uri).replace('}', ''));
              const version = postData.blocks ? '0.0.2' : '0.0.1';
              
              // Create post
              const post = await Post.query().insertGraph({
                publicKey: postPublicKey,
                data: postData,
                datetime: new Date(postAccount.createdAt.toNumber() * 1000).toISOString(),
                publisherId: authority.id,
                hubId: hub.id,
                version
              });
  
              // Process post content
              await this.processPostContent(postData, post.id);
  
              // Process reference release if provided
              let releaseId = null;
              if (releasePublicKey) {
                const release = await Release.query().findOne({ publicKey: releasePublicKey });
                releaseId = release.id;
                await this.processPostContent({ blocks: [{ type: 'featuredRelease', data: releasePublicKey }] }, post.id);
              }
  
              return {success: true, ids: { postId: post.id, hubId: hub.id, releaseId }};
            } catch (error) {
              logTimestampedMessage(`Error processing post transaction ${txid}: ${error.message}`);
              return {success: false};
            }
          }

          // case 'PostUpdateViaHubPost': {
          //   const postPublicKey = accounts[3].toBase58();
          //   const hubPublicKey = accounts[2].toBase58();
            
          //   const post = await Post.query().findOne({ publicKey: postPublicKey });
          //   const hub = await Hub.query().findOne({ publicKey: hubPublicKey });
            
          //   if (!post || !hub) {
          //     logTimestampedMessage(`Post or Hub not found for PostUpdateViaHubPost ${txid}`);
          //     return;
          //   }

          //   // Get updated post data
          //   const postAccount = await this.program.account.post.fetch(
          //     new anchor.web3.PublicKey(postPublicKey)
          //   );

          //   const postData = await fetchFromArweave(decode(postAccount.uri).replace('}', ''));
          //   const version = postData.blocks ? '0.0.2' : '0.0.1';
            
          //   // Update post
          //   await Post.query()
          //     .patch({
          //       data: postData,
          //       version
          //     })
          //     .where('id', post.id);

          //   // Reprocess post content
          //   await this.processPostContent(postData, post.id);

          //   // Update transaction reference
          //   await this.updateTransactionReferences(transaction, {
          //     postId: post.id,
          //     hubId: hub.id
          //   });

          //   break;
          // }
        }
      } catch (error) {
        logTimestampedMessage(`Error processing post transaction ${txid}: ${error.message}`);
      }
    }
}

export const postsProcessor = new PostsProcessor();
