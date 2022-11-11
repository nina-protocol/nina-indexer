const { default: axios } = require('axios');
const { Model } = require('objection');
const { stripHtmlIfNeeded, decode } = require('../../utils');

class Hub extends Model {
  static get tableName() {
    return 'hubs';
  }
  static get idColumn() {
    return 'id';
  }
  static get jsonSchema() {
    return {
      type: 'object',
      required: ['publicKey', 'handle', 'data', 'dataUri', 'datetime'],
      properties: {
        publicKey: { type: 'string' },
        handle: { type: 'string' },
        data: { type: 'object' },
        dataUri: { type: 'string' },
        datetime: { type: 'string' },
      },
    };
  }

  async format () {
    const authority = await this.$relatedQuery('authority').select('publicKey');
    this.authority = authority.publicKey;
    delete this.authorityId;
    delete this.id;

    stripHtmlIfNeeded(this.data, 'description');
  }

  static async updateHub(hub, hubAccount, hubContents, hubReleases, hubCollaborators, hubPosts) {
    const Account = require('./Account');
    const Post = require('./Post');
    const Release = require('./Release');
    if (typeof hubAccount.account.uri !== 'string') {
      hubAccount.account.uri = decode(hubAccount.account.uri)
    }
    if (!hub.dataUri || hub.dataUri !== hubAccount.account.uri) {
      const data = (await axios.get(hubAccount.account.uri)).data;
      await hub.$query().patch({
        data,
        dataUri: hubAccount.account.uri
      });
    }

    // Update Hub Releases
    const hubReleasesForHubOnChain = hubReleases.filter(x => x.account.hub.toBase58() === hub.publicKey);
    const hubReleasesForHubDb = (await Hub.relatedQuery('releases').for(hub)).map(x => x.publicKey);
    const newHubReleasesForHub = hubReleasesForHubOnChain.filter(x => !hubReleasesForHubDb.includes(x.account.release.toBase58()));

    for await (let hubRelease of hubReleasesForHubOnChain) {
      try {
        if (hubReleasesForHubDb.includes(hubRelease.account.release.toBase58())) {
          const hubContent = hubContents.filter(x => x.account.child.toBase58() === hubRelease.publicKey.toBase58())[0]
          if (!hubContent.account.visible) {
            const release = await Release.query().findOne({publicKey: hubRelease});
            if (release) {
              await Hub.relatedQuery('releases').for(hub.id).delete().where('releaseId', release.id);
            }
          }  
        }
      } catch (err) {
        console.log(err);
      }
    }
    for await (let hubRelease of newHubReleasesForHub) {
      try {
        const hubContent = hubContents.filter(x => x.account.child.toBase58() === hubRelease.publicKey.toBase58())[0]
        if (hubContent.account.visible) {
          const release = await Release.query().findOne({publicKey: hubRelease.account.release.toBase58()});
          if (release) {
            await Hub.relatedQuery('releases').for(hub.id).relate({
              id: release.id,
              hubReleasePublicKey: hubRelease.publicKey.toBase58(),
            });
            if (hubContent.account.publishedThroughHub) {
              await release.$query().patch({hubId: hub.id});
            }
            console.log('Related Release to Hub:', release.publicKey, hub.publicKey);  
          }
        }
      } catch (err) {
        console.log(err);
      }
    }
    
    // Update Hub Collaborators
    const hubCollaboratorsForHubOnChain = hubCollaborators.filter(x => x.account.hub.toBase58() === hub.publicKey);
    const hubCollaboratorsForHubDb = (await Hub.relatedQuery('collaborators').for(hub)).map(x => x.publicKey);
    const newHubCollaboratorsForHub = hubCollaboratorsForHubOnChain.filter(x => !hubCollaboratorsForHubDb.includes(x.account.collaborator.toBase58()));
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
    const hubPostsForHubOnChain = hubPosts.filter(x => x.account.hub.toBase58() === hub.publicKey);
    const hubPostsForHubDb = (await Hub.relatedQuery('posts').for(hub)).map(x => x.publicKey);
    const newHubPostsForHub = hubPostsForHubOnChain.filter(x => !hubPostsForHubDb.includes(x.account.post.toBase58()));

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
            if (release) {
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
  
  static get relationMappings() {
    const Account = require('./Account');
    const Release = require('./Release');
    const Post = require('./Post');

    return {
      authority: {
        relation: Model.HasOneRelation,
        modelClass: Account,
        join: {
          from: 'hubs.authorityId',
          to: 'accounts.id',
        },
      },
      collaborators: {
        relation: Model.ManyToManyRelation,
        modelClass: Account,
        join: {
          from: 'hubs.id',
          through: {
            from: 'hubs_collaborators.hubId',
            to: 'hubs_collaborators.accountId',
            extra: ['hubCollaboratorPublicKey'],
          },
          to: 'accounts.id',
        },
      },
      posts: {
        relation: Model.ManyToManyRelation,
        modelClass: Post,
        join: {
          from: 'hubs.id',
          through: {
            from: 'hubs_posts.hubId',
            to: 'hubs_posts.postId',
            extra: ['hubPostPublicKey'],
          },
          to: 'posts.id',
        },
      },
      releases: {
        relation: Model.ManyToManyRelation,
        modelClass: Release,
        join: {
          from: 'hubs.id',
          through: {
            from: 'hubs_releases.hubId',
            to: 'hubs_releases.releaseId',
            extra: ['hubReleasePublicKey'],
          },
          to: 'releases.id',
        },
      },
    }
  }
}

module.exports = Hub;