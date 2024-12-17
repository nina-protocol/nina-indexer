import KoaRouter from 'koa-router'
import { 
  Verification,
} from '@nina-protocol/nina-db';
import _  from 'lodash';

import { TransactionSyncer } from '../../indexer/src';

const router = new KoaRouter({
  prefix: '/verifications'
})

router.get('/:publicKey', async (ctx) => {
  try {
    let verification = await Verification.query().findOne({publicKey: ctx.params.publicKey})
    if (!verification) {
      await NinaProcessor.init();
      verification  = await getVerification(ctx.params.publicKey)
    }
    await verification.format()
    ctx.body = {
      verification,
    }
  } catch (error) {
    console.warn(error)
    ctx.status = 400
    ctx.body = {
      success: false,
    }
  }
})

router.get('/:publicKey/unregister', async (ctx) => {
  try {
    console.log('/verifications/:publicKey/unregister publicKey', ctx.params.publicKey)
    let verification = await Verification.query().findOne({publicKey: ctx.params.publicKey})
    console.log('verification', verification)
    if (verification) {
      let confirmedDeleted = false
      await NinaProcessor.init();
      let i = 0;
      while (!confirmedDeleted && i < 60) {
        console.log('publicKey', ctx.params.publicKey)
        console.log('i', i)
        console.log('confirmedDeleted', confirmedDeleted)
        i++;
        let ninaNameIdRegistry = await TransactionSyncer.connection.getAccountInfo(
          new anchor.web3.PublicKey(ctx.params.publicKey)
        );
        if (!ninaNameIdRegistry) {
          await verification.$query().delete()
          confirmedDeleted = true
          console.log('successfully deleted verification', ctx.params.publicKey)
        } else {
          await sleep(1500)
        }  
      }  
    }
    ctx.body = {
      success: true,
    }
  } catch (error) {
    console.warn(error)
    ctx.status = 400
    ctx.body = {
      success: false,
    }

  }
})

// helper functions
//TODO: PLUG INTO TRANSACTION SYNCER
const verficationRequest = async (publicKey) => {
  try {
    let verification = await NinaProcessor.processVerification(new anchor.web3.PublicKey(publicKey))
    return verification
  } catch (err) {
    return undefined
  }
}

const getVerification = async (publicKey) => {
  try {
    let i = 0;
    let verification
    while (!verification && i < 60) {
      verification = await verficationRequest(publicKey)
      i++;
      await sleep(500)
    }
    return verification
  } catch (err) {
    console.warn(err)
  }
}

export default router