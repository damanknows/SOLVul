---
id: "programs-program-verification"
title: "Solana On-Chain Program Verification & Allowlisting"
sourceUrl: "https://solana.com/docs/core/programs"
publisher: "Solana Foundation"
documentType: "official_docs"
category: "programs"
trustLevel: "authoritative"
createdAt: "2024-02-01T00:00:00Z"
---

# Program Verification and Ecosystem Trust

Solana allows arbitrary developers to deploy executable bytecode (programs) using the BPF / SBF loader.

## Verified vs Unverified Programs
- Verified programs are well-known ecosystem programs whose addresses and bytecode are universally recognized and audited (e.g., System Program, SPL Token, Token-2022, Memo Program, Associated Token Account Program).
- Unverified programs are custom deployed programs not present in a local or ecosystem registry.

## Security Evaluation Guidelines
- An unverified program is unverified, NOT automatically malicious.
- Novel DeFi protocols, games, and applications legitimately use newly deployed custom programs.
- However, when an unverified program requests signer privileges or writable access to token accounts or native SOL, pre-sign firewalls must issue an unverified program caution and highlight affected accounts.
- Pre-sign firewalls must inspect whether an unverified program executes risky operations or requests authority delegation.
