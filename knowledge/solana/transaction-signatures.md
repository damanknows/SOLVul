---
id: "solana-transaction-signatures"
title: "Solana Transaction Pre-Flight Inspection & Signatures Model"
sourceUrl: "https://solana.com/docs/core/transactions#signatures"
publisher: "Solana Foundation"
documentType: "official_docs"
category: "solana"
trustLevel: "authoritative"
createdAt: "2024-01-15T00:00:00Z"
---

# Solana Transaction Signatures and Pre-Sign Inspection

Transactions in Solana require cryptographic signatures from required signers before execution by validators.

## Pre-Sign Firewall Context
In a pre-flight or pre-signing firewall (such as a wallet extension or pre-sign inspector):
- Transactions received from dApps are inherently unsigned at inspection time.
- The user is viewing the transaction *specifically* to decide whether or not to sign it.
- Lack of signatures at pre-sign inspection is expected normal operational state and must never be treated as evidence of malicious intent or a severe vulnerability.

## Signer Privileges
- An account marked as `isSigner: true` in an instruction grants authorization for actions governed by that account.
- If a transaction requests the user's wallet public key as a writable signer on unknown or critical instructions, the wallet's funds and authorities are at direct risk.
- Address Lookup Tables (ALTs) in v0 transactions cannot grant signer privileges; all signers must reside in the static transaction account keys table.
