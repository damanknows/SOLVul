---
id: "token-2022-extensions"
title: "Token-2022 Program Extensions Security & Capabilities"
sourceUrl: "https://spl.solana.com/token-2022/extensions"
publisher: "Solana Program Library"
documentType: "official_docs"
category: "token-security"
trustLevel: "authoritative"
createdAt: "2024-02-15T00:00:00Z"
---

# Token-2022 Program Extensions

The Token-2022 program (`TokenzQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`) introduces modular extensions that augment standard token capabilities.

## Critical Extensions
- `PermanentDelegate`: Enables a designated permanent delegate to transfer or burn tokens from any token account of the mint without requiring the token account owner's signature. This is used for compliance, stablecoins, and token recoveries, but poses centralized control risks.
- `TransferHook`: Executes a custom program instruction on every transfer, which can enforce custom logic, whitelists, or fees.
- `DefaultAccountState`: Can force all newly created token accounts to be frozen by default until an authority unfreezes them.
- `ConfidentialTransfers`: Encrypts balances and transfer amounts using zero-knowledge proofs.

## Pre-Sign Evaluation
- When encountering Token-2022 mints, pre-sign inspectors must notify users if the mint has a permanent delegate or transfer hooks enabled.
- Unsupported extensions must preserve raw instruction data rather than failing silently.
