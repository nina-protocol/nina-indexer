import request from 'supertest';
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { it } from 'mocha';
import {
  Account,
  Hub,
  Post,
  Release,
  Transaction,
  connectDb,
} from '@nina-protocol/nina-db';
import TransactionSyncer from '../indexer/src/TransactionSyncer.js';

const { expect } = chai;
chai.use(chaiAsPromised);

describe('Tests for the API', async function() {
  before(async function() {
    await connectDb()
    await TransactionSyncer.initialize();
  });

  it('should return the price of SOL', async function() {
    const response = await request(process.env.MOCHA_ENDPOINT_URL).get('/v1/solPrice');
    expect(response.status).to.equal(200);
    expect(response.body).to.have.property('data');
    expect(response.body.data).to.have.property('So11111111111111111111111111111111111111112');
    expect(response.body.data.So11111111111111111111111111111111111111112).to.have.property('price');
  });


  describe('Release Callbacks', async function() {
    it('should process a release with txid', async function() {
      const releaseInitTxId = '31rAhCh2xqGLDvVHH191xSUqgNfVhyiXMNfXpVFHt4fVEVDnsvq33EMTSM3zh2z6XfJf895S2RYDdzv99VDx3AGT';
      const releasePublicKey = 'HTKjNcZJSReXWQo4tDQZSA9jw5nL5E2BYgbBCegPmB9F'

      await Release.query().delete().where('publicKey', releasePublicKey);
      await Transaction.query().delete().where('txid', releaseInitTxId);

      const releaseBefore = await Release.query().findOne({ publicKey: releasePublicKey });
      expect(releaseBefore).to.not.exist;
      const transactionBefore = await Transaction.query().findOne({ txid: releaseInitTxId });
      expect(transactionBefore).to.not.exist;

      const response = await request(process.env.MOCHA_ENDPOINT_URL).get(`/v1/releases/${releasePublicKey}?txid=${releaseInitTxId}`);
      expect(response.status).to.equal(200);
      expect(response.body).to.have.property('release');
      expect(response.body.release).to.have.property('publicKey');
      expect(response.body.release.publicKey).to.equal(releasePublicKey);
  
      const release = await Release.query().findOne({ publicKey: releasePublicKey });
      expect(release).to.exist;

      const count = await TransactionSyncer.processAndInsertTransactions([{signature: releaseInitTxId}]);
      expect(count).to.equal(1);

      const transactionAfter = await Transaction.query().findOne({ txid: releaseInitTxId });
      expect(transactionAfter).to.exist;
    });
  
    it('should process release purchase with txId', async function() {
      const releasePurchaseTxId = 'QaiVtuSC4CDaTC28E1oWThAz9Dg1hL9csTeMCCBowefrbkG4hBcdun1ZzDXN8AvSBYopAjovzuUSe71HeUpS8h5'
      const releasePublicKey = '9DPKhFmxWe3ZQrrnLRseWKRknTQEMeLLKzWGnufKriBf'
      const purchaserPublicKey = '9h7SMdDVaknN62eLTQF6wvhpmrXShAFmZeSKn5K9LMUj'
  
      const account = await Account.query().findOne({ publicKey: purchaserPublicKey });
      const release = await Release.query().findOne({ publicKey: releasePublicKey });
  
      await account.$relatedQuery('collected').unrelate().where('releaseId', release.id);
      await Transaction.query().delete().where('txid', releasePurchaseTxId);

      const releaseCollectedBefore = await account.$relatedQuery('collected').where('releaseId', release.id);
      expect(releaseCollectedBefore).to.be.an('array');
      expect(releaseCollectedBefore).to.be.empty;

      const transactionBefore = await Transaction.query().findOne({ txid: releasePurchaseTxId });
      expect(transactionBefore).to.not.exist;

      const response = await request(process.env.MOCHA_ENDPOINT_URL).get(`/v1/releases/${releasePublicKey}/collectors/${purchaserPublicKey}?txId=${releasePurchaseTxId}`);
      expect(response.status).to.equal(200);
      expect(response.body).to.have.property('collected');
      expect(response.body.collected).to.be.true;

      const releaseCollectedAfter = await account.$relatedQuery('collected').where('releaseId', release.id);
      expect(releaseCollectedAfter).to.be.an('array');
      expect(releaseCollectedAfter).to.have.length(1);

      const count = await TransactionSyncer.processAndInsertTransactions([{signature: releasePurchaseTxId}]);
      expect(count).to.equal(1);

      const transactionAfter = await Transaction.query().findOne({ txid: releasePurchaseTxId });
      expect(transactionAfter).to.exist;
    });  
  });

  describe('Hub Callbacks', async function() {
    it('should process a hub with txid', async function() {
      const hubInitTxid = '5ehkFQ9VT4iteipp38SX9vXNTHxKrsAuSMoZSkr8ZhkvBC4ApeA9mQUyRFLV45GRm73AyeiGds2Tz247amB2XC9o';
      const hubPublicKey = 'E1YBhJjTpLvwJiEjjHYmPjRUSJX9tshuDQrSyV1gK3eU'
  
      await Hub.query().delete().where('publicKey', hubPublicKey);
      await Transaction.query().delete().where('txid', hubInitTxid);

      const hubBefore = await Hub.query().findOne({ publicKey: hubPublicKey });
      expect(hubBefore).to.not.exist;

      const transactionBefore = await Transaction.query().findOne({ txid: hubInitTxid });
      expect(transactionBefore).to.not.exist;

      const response = await request(process.env.MOCHA_ENDPOINT_URL).get(`/v1/hubs/${hubPublicKey}/tx/${hubInitTxid}`);
      expect(response.status).to.equal(200);
      expect(response.body).to.have.property('hub');
      expect(response.body.hub).to.have.property('publicKey');
      expect(response.body.hub.publicKey).to.equal(hubPublicKey);  

      const hubAfter = await Hub.query().findOne({ publicKey: hubPublicKey });
      expect(hubAfter).to.exist;

      const count = await TransactionSyncer.processAndInsertTransactions([{signature: hubInitTxid}]);
      expect(count).to.equal(1);

      const transactionAfter = await Transaction.query().findOne({ txid: hubInitTxid });
      expect(transactionAfter).to.exist;
    });

    it('should process hub add release with txid', async function() {
      const hubAddReleaseTxid = '58FxaicgXzgVLmLRcpdnW7du99b7rfTwxvToMsiKpqhMpNRPcomhnCPkh6tcRn76rvkdYGWsETTNoQRpFbYrtfkA';
      const hubPublicKey = '9vEvGwYM2mim8DoqkVt1u4UtGTmJHfZ29vsgauFLBEmF'
      const releasePublicKey = '2otKpquDQMZV4htzER68W9D1EJYqpnffpwsmo3KG58v3'
      const hubReleasePublicKey = 'J8DpUkfSBGtfxxNzKTMndfqZfYZjzRBhx1EnceFhEAUX'

      const hub = await Hub.query().findOne({ publicKey: hubPublicKey });
      const release = await Release.query().findOne({ publicKey: releasePublicKey });

      await hub.$relatedQuery('releases').unrelate().where('releaseId', release.id);
      await Transaction.query().delete().where('txid', hubAddReleaseTxid);

      const hubReleaseBefore = await hub.$relatedQuery('releases').where('releaseId', release.id);
      expect(hubReleaseBefore).to.be.an('array');
      expect(hubReleaseBefore).to.be.empty;

      const transactionBefore = await Transaction.query().findOne({ txid: hubAddReleaseTxid });
      expect(transactionBefore).to.not.exist;

      const response = await request(process.env.MOCHA_ENDPOINT_URL).get(`/v1/hubs/${hubPublicKey}/hubReleases/${hubReleasePublicKey}?txid=${hubAddReleaseTxid}`);
      expect(response.status).to.equal(200);
      expect(response.body).to.have.property('release');
      expect(response.body.release).to.have.property('publicKey');
      expect(response.body.release.publicKey).to.equal(releasePublicKey);

      expect(response.body).to.have.property('hub');
      expect(response.body.hub).to.have.property('publicKey');
      expect(response.body.hub.publicKey).to.equal(hubPublicKey);

      const hubReleaseAfter = await hub.$relatedQuery('releases').where('releaseId', release.id);
      expect(hubReleaseBefore).to.be.an('array');
      expect(hubReleaseAfter).to.have.length(1);

      const count = await TransactionSyncer.processAndInsertTransactions([{signature: hubAddReleaseTxid}]);
      expect(count).to.equal(1);

      const transactionAfter = await Transaction.query().findOne({ txid: hubAddReleaseTxid });
      expect(transactionAfter).to.exist;
    });
  });

  describe('Account Callbacks', async function() {
    it('should process an account collected with txid', async function() {
      const releasePurchaseTxId = 'QaiVtuSC4CDaTC28E1oWThAz9Dg1hL9csTeMCCBowefrbkG4hBcdun1ZzDXN8AvSBYopAjovzuUSe71HeUpS8h5'
      const releasePublicKey = '9DPKhFmxWe3ZQrrnLRseWKRknTQEMeLLKzWGnufKriBf'
      const purchaserPublicKey = '9h7SMdDVaknN62eLTQF6wvhpmrXShAFmZeSKn5K9LMUj'
  
      const account = await Account.query().findOne({ publicKey: purchaserPublicKey });
      const release = await Release.query().findOne({ publicKey: releasePublicKey });
  
      await account.$relatedQuery('collected').unrelate().where('releaseId', release.id);
      await Transaction.query().delete().where('txid', releasePurchaseTxId);

      const accountCollectedBefore = await account.$relatedQuery('collected').where('releaseId', release.id);
      expect(accountCollectedBefore).to.be.an('array');
      expect(accountCollectedBefore).to.be.empty;

      const transactionBefore = await Transaction.query().findOne({ txid: releasePurchaseTxId });
      expect(transactionBefore).to.not.exist;

      const response = await request(process.env.MOCHA_ENDPOINT_URL).get(`/v1/accounts/${purchaserPublicKey}/collected?txId=${releasePurchaseTxId}`);
      expect(response.status).to.equal(200);
      expect(response.body).to.have.property('collected');
      expect(response.body.collected).to.be.an('array');

      const accountCollectedAfter = await account.$relatedQuery('collected').where('releaseId', release.id);
      expect(accountCollectedAfter).to.be.an('array');
      expect(accountCollectedAfter).to.have.length(1);

      const count = await TransactionSyncer.processAndInsertTransactions([{signature: releasePurchaseTxId}]);
      expect(count).to.equal(1);

      const transactionAfter = await Transaction.query().findOne({ txid: releasePurchaseTxId });
      expect(transactionAfter).to.exist
    });

    it('should process an account collected with releasePublicKey', async function() {
      const releasePublicKey = '9DPKhFmxWe3ZQrrnLRseWKRknTQEMeLLKzWGnufKriBf'
      const purchaserPublicKey = '9h7SMdDVaknN62eLTQF6wvhpmrXShAFmZeSKn5K9LMUj'
  
      const account = await Account.query().findOne({ publicKey: purchaserPublicKey });
      const release = await Release.query().findOne({ publicKey: releasePublicKey });
  
      await account.$relatedQuery('collected').unrelate().where('releaseId', release.id);
      const accountCollectedBefore = await account.$relatedQuery('collected').where('releaseId', release.id);
      expect(accountCollectedBefore).to.be.an('array');
      expect(accountCollectedBefore).to.be.empty;

      const response = await request(process.env.MOCHA_ENDPOINT_URL).get(`/v1/accounts/${purchaserPublicKey}/collected?releasePublicKey=${releasePublicKey}`);
      expect(response.status).to.equal(200);
      expect(response.body).to.have.property('collected');
      expect(response.body.collected).to.be.an('array');

      const accountCollectedAfter = await account.$relatedQuery('collected').where('releaseId', release.id);
      expect(accountCollectedAfter).to.be.an('array');
      expect(accountCollectedAfter).to.have.length(1);
    });
  });

  describe('Post Callbacks', async function() {
    it('should process a post with txid', async function() {
      const postInitTxId = '2JYLpDJ5e6fzhDCAHfkwbNSGakdGuSL1ygYqDHSUWnLwxaHZUgeq2moNjL9BBnYPXE4smScVN3jqwVDc7ePQmrDU';
      const postPublicKey = 'Et1GZidxQc3Vp8V1cJuuCc3zDFri43spCetkTp6781B7'

      // Delete the post and transaction if they exist
      await Post.query().delete().where('publicKey', postPublicKey);
      await Transaction.query().delete().where('txid', postInitTxId);

      // Check that the post and transaction were deleted
      const postBefore = await Post.query().findOne({ publicKey: postPublicKey });
      expect(postBefore).to.not.exist;
      const transactionBefore = await Transaction.query().findOne({ txid: postInitTxId });
      expect(transactionBefore).to.not.exist;

      // Call the API callback and expect the post to be created
      const response = await request(process.env.MOCHA_ENDPOINT_URL).get(`/v1/posts/${postPublicKey}?txid=${postInitTxId}`);
      expect(response.status).to.equal(200);
      expect(response.body).to.have.property('post');
      expect(response.body.post).to.have.property('publicKey');
      expect(response.body.post.publicKey).to.equal(postPublicKey);

      // Check that the post was created
      const postAfter = await Post.query().findOne({ publicKey: postPublicKey });
      expect(postAfter).to.exist;

      // call the transaction syncer directly and create the transaction even though the post already exists
      const count = await TransactionSyncer.processAndInsertTransactions([{signature: postInitTxId}]);
      expect(count).to.equal(1);

      // Check that the transaction was created
      const transactionAfter = await Transaction.query().findOne({ txid: postInitTxId });
      expect(transactionAfter).to.exist;
    });
  });
});