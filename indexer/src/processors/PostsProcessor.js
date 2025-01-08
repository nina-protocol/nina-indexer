import { BaseProcessor } from './base/BaseProcessor.js';
import { Account, Hub, Post, Release } from '@nina-protocol/nina-db';
import { logTimestampedMessage } from '../utils/logging.js';
import { callRpcMethodWithRetry, decode, fetchFromArweave } from '../utils/index.js';
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
              let releaseId = null;

              let hub = await Hub.query().findOne({ publicKey: hubPublicKey });
              if (!hub) {
                logTimestampedMessage(`Hub not found for ${transaction.type} ${txid}`);
                return;
              }

              let post = await Post.query().findOne({ publicKey: postPublicKey });
              if (post) {
                logTimestampedMessage(`Post already exists for ${transaction.type} ${txid}`);
                if (releasePublicKey) {
                  const release = await Release.query().findOne({ publicKey: releasePublicKey });
                  releaseId = release.id;
                }
                return { success: true, ids: { postId: post.id, hubId: hub.id }};
              }

              // Fetch post data from program
              const postAccount = await callRpcMethodWithRetry(() => this.program.account.post.fetch(
                new anchor.web3.PublicKey(postPublicKey)
              ));
              // Process post data
              const postData = await fetchFromArweave(decode(postAccount.uri).replace('}', ''));
              const version = postData.blocks ? '0.0.2' : '0.0.1';
              
              // Create post
              post = await Post.query().insertGraph({
                publicKey: postPublicKey,
                data: postData,
                datetime: new Date(postAccount.createdAt.toNumber() * 1000).toISOString(),
                publisherId: authority.id,
                hubId: hub.id,
                version
              }).onConflict('publicKey').ignore();
  
              // Process post content
              await this.processPostContent(postData, post.id);
              // Process reference release if provided
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
        }
      } catch (error) {
        logTimestampedMessage(`xxError processing post transaction ${txid}: ${error.message}`);
      }
    }
}

export const postsProcessor = new PostsProcessor();
