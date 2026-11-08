---
id: "tx-simulation-limitations"
title: "Solana RPC Transaction Simulation Limitations & Execution Edge Cases"
sourceUrl: "https://solana.com/docs/core/transactions/simulation"
publisher: "Solana Foundation"
documentType: "official_docs"
category: "transaction-security"
trustLevel: "authoritative"
createdAt: "2024-02-10T00:00:00Z"
---

# Transaction Simulation Realities & Limitations

Pre-flight RPC transaction simulation (`simulateTransaction`) executes a transaction against a local bank snapshot on a Solana validator RPC node without broadcasting it to the cluster.

## Simulation Limitations
1. **Mock Balances**: Simulation against mock or fresh devnet keypairs often fails due to `InsufficientFunds` or `AccountNotFound`, even when the transaction bytecode itself is valid.
2. **Expired Blockhash**: Blockhashes expire in ~150 slots (~60-90 seconds). An expired blockhash causes simulation failure.
3. **Cluster State Drift**: Simulation runs against current slot state; by the time a transaction is signed and broadcasted, state may have changed.
4. **Conditional & Honeypot Logic**: Smart contracts can inspect remaining compute budget, current slot, or transaction signatures to alter behavior between simulation and real broadcast.
5. **Simulation Success Invariant**: A successful simulation does not guarantee that a transaction is safe or non-malicious. For instance, an `Approve` instruction executes successfully in simulation without transferring tokens, yet permits a catastrophic drain later.
