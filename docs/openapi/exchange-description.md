`Exchanges` are instances of Secondary Market activity through the Nina program.

An `Exchange` may describe an open, cancelled, or completed exchange.

If `exchange.cancelled` is `true`, the `exchange` is cancelled and the on-chain Exchange account has been closed.

If `exchange.completedBy` is not null the `exchange` has been completed.

Cancelled and Completed Exchanges have had their on-chain accounts closed - you can no longer them on-chain.