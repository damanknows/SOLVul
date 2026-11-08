---
id: "solana-system-program"
title: "Solana System Program & Account Reassignment Reference"
sourceUrl: "https://solana.com/docs/core/programs#system-program"
publisher: "Solana Foundation"
documentType: "official_docs"
category: "solana"
trustLevel: "authoritative"
createdAt: "2024-01-15T00:00:00Z"
---

# Solana System Program Overview

The System Program (`11111111111111111111111111111111`) is responsible for managing accounts, creating new accounts, allocating data space, assigning accounts to owning programs, and transferring native SOL.

## SystemProgram::Transfer
Transfers lamports from a source account to a destination account.
- The source account must be a signer.
- The transaction fee payer pays the transaction fee.
- When inspecting unsigned transactions, transfers of large or unexpected SOL balances must be flagged to prevent wallet drain.

## SystemProgram::Assign
Assigns an account to a new owner program (`Assign` instruction).
- Reassigning an account changes its program owner on the Solana runtime.
- Once reassigned, only the new owner program has write and debit authority over the account data and lamports.
- Security Risk: Malicious dApps or phishers use `Assign` to stealthily transfer ownership of an account to an attacker-controlled program, surrendering control of all current and future state.

## SystemProgram::CreateAccount
Allocates space and transfers initial rent-exempt lamports to initialize a new account, optionally assigning it to an owner program in the same atomic instruction.
