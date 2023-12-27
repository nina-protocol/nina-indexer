import * as anchor from '@project-serum/anchor';
const getTx = async (txid) => {
  const connection = new anchor.web3.Connection('https://nina.rpcpool.com/a4720dd909cb194f1d9ea07d50ee');

  const tx = await connection.getParsedTransaction(txid, {
    maxSupportedTransactionVersion: 0
  })
  for (let innerInstruction of tx.meta.innerInstructions) {
    for (let instruction of innerInstruction.instructions) {
      if (instruction.programId.toBase58() === 'ninaN2tm9vUkxoanvGcNApEeWiidLMM2TdBX8HoJuL4') {
        console.log(instruction)
      }
    }
  }
}


getTx('ncYuAjmP51SWMnqzs5LQuLugHWtVkrJJ18RnYsctw9ZwZ64TGbB8hJypED5tc3yc6njZtRS6v86rqQ2r5Dv8Wep')
