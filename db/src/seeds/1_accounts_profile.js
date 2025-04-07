import 'dotenv/config';
import axios from 'axios';
import { Account, connectDb } from '../index.js';
export const seed = async () => {
  await connectDb();
  
  const accountsWithoutHandle = await Account.query().whereNull('handle');

  for await (let account of accountsWithoutHandle) {
    try {
      const response = await axios.get(`${process.env.ID_SERVER_ENDPOINT}/profile/${account.publicKey}`);
      await account.$query().patch({
        handle: response.data.profile.handle,
        displayName: response.data.profile.displayName,
        image: response.data.profile.image,
        description: response.data.profile.description,
      });
      console.log('Updated Account:', account.handle, account.publicKey);  
    } catch (error) {
      console.log('Error updating Account', account.publicKey, error);
    }
  }
}