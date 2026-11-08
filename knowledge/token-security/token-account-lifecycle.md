---
id: "token-account-lifecycle"
title: "SPL Token Account Lifecycle & CloseAccount Rent Extraction"
sourceUrl: "https://spl.solana.com/token#close-account"
publisher: "Solana Program Library"
documentType: "official_docs"
category: "token-security"
trustLevel: "authoritative"
createdAt: "2024-01-20T00:00:00Z"
---

# SPL Token Account Lifecycle & CloseAccount

Token accounts on Solana hold a minimum rent-exempt balance in lamports (approximately ~0.002 SOL) allocated upon initialization.

## CloseAccount Instruction
The `CloseAccount` instruction destroys the token account and directs all remaining rent lamports to a specified destination account.
- The token balance must be zero (`amount == 0`) before a standard token account can be closed.
- The owner or designated close authority must sign the instruction.

## Security Risk: Rent Reclamation Hijack
- Phishing dApps inject `CloseAccount` instructions into batch transactions.
- The dApp directs the destination for the reclaimed rent lamports to an attacker-controlled wallet rather than the user's wallet.
- Over hundreds of token accounts, closing accounts and redirecting rent lamports constitutes a silent balance drain.
- Pre-sign inspection must verify whether the `destination` account in `CloseAccount` matches the user's connected wallet address.
