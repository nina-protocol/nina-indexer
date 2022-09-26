`Releases` are a Nina primitive that connects metadata and audio files hosted on Arweave to an account on Solana which handles provenance, purchases, and revenue shares.

Relations:
  - `exchanges`: [Exchanges](/#tag/Exchanges) for the `Release` (open, cancelled, or completed)
  - `collectors`: [Accounts](/#tag/Accounts) that currently hold the `Release`
  - `hubs`: [Hubs](/#tags/Hubs) that the `Release` has been published or reposted to
  - `revenueShareRecipients`: [Accounts](/#tag/Accounts) that have a Revenue Share in the `Release` (each `Release` can have a maximum of 10 `revenueShares` with 0-100% share always adding up to 100% across all `revenueShares`)
