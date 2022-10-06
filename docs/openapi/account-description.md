`Accounts` describe instances of Users on Nina and are created when a wallet interacts with the Nina program in any way. 

An Account's `publicKey` is the the address of the Solana wallet that owns the `Account`.

Relations:
 - `published`: [Releases](/#tag/Releases) published by an Account
 - `collected`: [Releases](/#tag/Releases) currently held by an Account
 - `exchanges`: [Exchanges](/#tag/Exchanges) exchanges opened, cancelled, or completed by an Account
 - `hubs`: [Hubs](/#tag/Hubs) that an account is a collaborator on
 - `posts`: [Posts](/#tag/Posts) that an account has published
 - `revenueShares`: [Releases](/#tag/Releases) that an Account has a revenue share on
