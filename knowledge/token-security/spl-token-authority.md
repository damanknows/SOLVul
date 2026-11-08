---
id: "token-spl-authority"
title: "SPL Token SetAuthority Ownership & Mint Hijack"
sourceUrl: "https://spl.solana.com/token#set-authority"
publisher: "Solana Program Library"
documentType: "official_docs"
category: "token-security"
trustLevel: "authoritative"
createdAt: "2024-01-20T00:00:00Z"
---

# SPL Token SetAuthority Operations

The `SetAuthority` instruction reassigns critical authorities on a token mint or token account.

## Authority Types
- `MintTokens`: Authority to mint new token units.
- `FreezeAccount`: Authority to freeze token accounts holding the mint.
- `AccountOwner`: Full ownership and withdrawal authority over an individual token account.
- `CloseAccount`: Authority to close the token account and recover rent lamports.

## Security Risk: Ownership Hijack
- When a user signs a `SetAuthority` instruction changing `AccountOwner` to an external public key, ownership of that token account is permanently transferred away from the user.
- The original owner immediately loses all ability to transfer, burn, or close the account.
- Phishing dApps disguise `SetAuthority` instructions under false pretexts ("upgrade account", "stake tokens").
- In pre-sign inspection, any `SetAuthority` transaction where the new authority does not belong to the user is a high-severity critical security event.
