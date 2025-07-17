export const environmentIsSetup = () => {
  if (process.env.POSTGRES_HOST === undefined) {
    throw('POSTGRES_HOST is not set');
  } else if (process.env.POSTGRES_DATABASE === undefined) {
    throw('POSTGRES_DATABASE is not set');
  } else if (process.env.POSTGRES_USER === undefined) {
    throw('POSTGRES_USER is not set');
  } else if (process.env.POSTGRES_PASSWORD === undefined) {
    throw('POSTGRES_PASSWORD is not set');
  } else if (process.env.SOLANA_CLUSTER_URL === undefined) {
    throw('SOLANA_CLUSTER_URL is not set');
  } else if (process.env.NINA_PROGRAM_ID === undefined) {
    throw('NINA_PROGRAM_ID is not set');
  } else if (process.env.REDIS_URL === undefined) {
    throw('REDIS_URL is not set');
  } else if (process.env.NINA_PROGRAM_V2_ID === undefined) {
    throw('NINA_PROGRAM_V2_ID is not set');
  }

  return true
}