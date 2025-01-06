import request from 'supertest';
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';

import {
  Account,
  Hub,
  Release,
  connectDb,
} from '@nina-protocol/nina-db';
import { it } from 'mocha';

const { expect } = chai;
chai.use(chaiAsPromised);

describe('Tests for the API', async function() {
  before(async function() {
    await connectDb()
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
  
      const response = await request(process.env.MOCHA_ENDPOINT_URL).get(`/v1/releases/${releasePublicKey}?txid=${releaseInitTxId}`);
      expect(response.status).to.equal(200);
      expect(response.body).to.have.property('release');
      expect(response.body.release).to.have.property('publicKey');
      expect(response.body.release.publicKey).to.equal(releasePublicKey);
  
      const release = await Release.query().findOne({ publicKey: releasePublicKey });
      expect(release).to.exist;
    });
  
    it('should process release purchase with txId', async function() {
      const releasePurchaseTxId = 'QaiVtuSC4CDaTC28E1oWThAz9Dg1hL9csTeMCCBowefrbkG4hBcdun1ZzDXN8AvSBYopAjovzuUSe71HeUpS8h5'
      const releasePublicKey = '9DPKhFmxWe3ZQrrnLRseWKRknTQEMeLLKzWGnufKriBf'
      const purchaserPublicKey = '9h7SMdDVaknN62eLTQF6wvhpmrXShAFmZeSKn5K9LMUj'
  
      const account = await Account.query().findOne({ publicKey: purchaserPublicKey });
      const release = await Release.query().findOne({ publicKey: releasePublicKey });
  
      await account.$relatedQuery('collected').unrelate().where('releaseId', release.id);
  
      const releaseCollectedBefore = await account.$relatedQuery('collected').where('releaseId', release.id);
      expect(releaseCollectedBefore).to.be.an('array');
      expect(releaseCollectedBefore).to.be.empty;

      const response = await request(process.env.MOCHA_ENDPOINT_URL).get(`/v1/releases/${releasePublicKey}/collectors/${purchaserPublicKey}?txId=${releasePurchaseTxId}`);
      expect(response.status).to.equal(200);
      expect(response.body).to.have.property('collected');
      expect(response.body.collected).to.be.true;

      const releaseCollectedAfter = await account.$relatedQuery('collected').where('releaseId', release.id);
      expect(releaseCollectedAfter).to.be.an('array');
      expect(releaseCollectedAfter).to.have.length(1);
    });  
  });

  describe('Hub Callbacks', async function() {
    it('should process a hub with txid', async function() {
      const hubInitTxid = '5ehkFQ9VT4iteipp38SX9vXNTHxKrsAuSMoZSkr8ZhkvBC4ApeA9mQUyRFLV45GRm73AyeiGds2Tz247amB2XC9o';
      const hubPublicKey = 'E1YBhJjTpLvwJiEjjHYmPjRUSJX9tshuDQrSyV1gK3eU'
  
      await Hub.query().delete().where('publicKey', hubPublicKey);
      const hubBefore = await Hub.query().findOne({ publicKey: hubPublicKey });
      expect(hubBefore).to.not.exist;

      const response = await request(process.env.MOCHA_ENDPOINT_URL).get(`/v1/hubs/${hubPublicKey}/tx/${hubInitTxid}`);
      expect(response.status).to.equal(200);
      expect(response.body).to.have.property('hub');
      expect(response.body.hub).to.have.property('publicKey');
      expect(response.body.hub.publicKey).to.equal(hubPublicKey);  

      const hubAfter = await Hub.query().findOne({ publicKey: hubPublicKey });
      expect(hubAfter).to.exist;
    });

    it('should process hub add release with txid', async function() {
      const hubAddReleaseTxid = '58FxaicgXzgVLmLRcpdnW7du99b7rfTwxvToMsiKpqhMpNRPcomhnCPkh6tcRn76rvkdYGWsETTNoQRpFbYrtfkA';
      const hubPublicKey = '9vEvGwYM2mim8DoqkVt1u4UtGTmJHfZ29vsgauFLBEmF'
      const releasePublicKey = '2otKpquDQMZV4htzER68W9D1EJYqpnffpwsmo3KG58v3'
      const hubReleasePublicKey = 'J8DpUkfSBGtfxxNzKTMndfqZfYZjzRBhx1EnceFhEAUX'

      const hub = await Hub.query().findOne({ publicKey: hubPublicKey });
      const release = await Release.query().findOne({ publicKey: releasePublicKey });

      await hub.$relatedQuery('releases').unrelate().where('releaseId', release.id);
      const hubReleaseBefore = await hub.$relatedQuery('releases').where('releaseId', release.id);
      expect(hubReleaseBefore).to.be.an('array');
      expect(hubReleaseBefore).to.be.empty;

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
      const accountCollectedBefore = await account.$relatedQuery('collected').where('releaseId', release.id);
      expect(accountCollectedBefore).to.be.an('array');
      expect(accountCollectedBefore).to.be.empty;

      const response = await request(process.env.MOCHA_ENDPOINT_URL).get(`/v1/accounts/${purchaserPublicKey}/collected?txId=${releasePurchaseTxId}`);
      expect(response.status).to.equal(200);
      expect(response.body).to.have.property('collected');
      expect(response.body.collected).to.be.an('array');

      const accountCollectedAfter = await account.$relatedQuery('collected').where('releaseId', release.id);
      expect(accountCollectedAfter).to.be.an('array');
      expect(accountCollectedAfter).to.have.length(1);
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
});