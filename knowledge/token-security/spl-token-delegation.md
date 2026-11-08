---
id: "token-spl-delegation"
title: "SPL Token Approve & Delegation Drain Vulnerability"
sourceUrl: "https://spl.solana.com/token#authority-delegation"
publisher: "Solana Program Library"
documentType: "official_docs"
category: "token-security"
trustLevel: "authoritative"
createdAt: "2024-01-20T00:00:00Z"
---

# SPL Token Delegation & Approve Instruction

The `Approve` instruction in the SPL Token and Token-2022 programs delegates transfer authority over a token account to a designated delegate address up to a specified maximum amount.

## Attack Vector: Unlimited Delegation (u64::MAX)
- When a user signs an `Approve` instruction with an excessive or maximum amount (`u64::MAX` = 18,446,744,073,709,551,615 base units), the delegate is empowered to transfer out the owner's entire token balance.
- This delegate authority persists indefinitely until explicitly revoked with a `Revoke` instruction or until the tokens are depleted.
- Malicious phishing sites prompt users to "connect" or "claim airdrop" by presenting an `Approve` instruction. The user believes they are merely authenticating, but they are granting full draining authority to the attacker's contract or wallet.

## Pre-Sign Protection
- Pre-sign firewalls must flag all `Approve` instructions where the delegated amount exceeds normal transaction bounds or equals unlimited u64 max.
- The firewall must display the delegate address and inform the user that approving allows that address to debit tokens at will in future blocks.
