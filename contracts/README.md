# DemoChog contract reference

[DemoChog.sol](src/DemoChog.sol) is a separate permissionless-mint ERC-721 test collection. It must not be presented as the original or official Chog collection. Progression remains application state; this Solidity contract stores ownership and metadata configuration, not XP.

[Protocol](../docs/protocol.md) · [Deployment](../docs/deployment.md) · [Security](../docs/security.md)

## Recorded deployment

| Field             | Recorded value                                          |
| ----------------- | ------------------------------------------------------- |
| Network / chain   | Monad Testnet / `10143`                                 |
| Name / symbol     | `CHOG Evolution Demo` / `DCHOG`                         |
| Address           | `0x45119A32ca6C4d67424401dA92Abe4EC6c83f8Ce`            |
| Supply cap        | 10,000                                                  |
| Deployment record | [monad-testnet.json](../deployments/monad-testnet.json) |
| Metadata update   | [demo-metadata.json](../deployments/demo-metadata.json) |

Verify current chain ID, bytecode, owner and metadata independently. The initial manifest's empty base URI describes deployment time; the separate metadata record preserves the later confirmed update.

## Construction and storage

```solidity
constructor(uint256 maxSupply_, string memory baseTokenURI_)
```

The deployer becomes Ownable owner. `maxSupply` is immutable. `nextTokenId` starts at 1, and the private base URI is owner-mutable. ERC-721 implementation comes from pinned OpenZeppelin dependencies. Constructor input validation does not add a minimum cap; a zero-cap deployment simply cannot mint.

## Interface and behavior

| Method                               | Access                | Behavior                                                                                  |
| ------------------------------------ | --------------------- | ----------------------------------------------------------------------------------------- |
| `mint()`                             | Any caller            | Nonpayable `_safeMint` to `msg.sender`; returns next ID and reverts `SoldOut()` above cap |
| `nextTokenId()`                      | Public view           | Next ID; minted count is `nextTokenId - 1`                                                |
| `maxSupply()`                        | Public view           | Immutable cap                                                                             |
| `setBaseURI(string)`                 | Owner                 | Replace collection-wide URI prefix                                                        |
| `ownerOf(uint256)`                   | ERC-721 view          | Current token owner; nonexistent tokens revert                                            |
| `tokenURI(uint256)`                  | ERC-721 view          | `<baseURI><decimal tokenId>` when the base is nonempty                                    |
| Standard ERC-721 approvals/transfers | Standard access rules | Inherited NFT ownership control                                                           |
| Ownable transfer/renounce            | Owner                 | Inherited owner administration                                                            |

There is no per-wallet mint cap, XP setter, quest evaluator, burn extension, metadata freeze or GenLayer verification in this contract. Mint price is zero; network gas is still paid. `_safeMint` invokes the ERC-721 receiver hook for contract recipients.

## Metadata and evolution

The configured public base is intended to resolve to `/api/v1/metadata/demo/`. The endpoint verifies minted existence and reads persisted progression/equipment, returning dynamic metadata and a published image or deterministic fallback. Published artifact URLs are immutable, while the token metadata endpoint is short-cached.

`setBaseURI` can change all demo token presentation; the contract does not validate the URL or freeze its contents. Owner/hosting trust is explicit. Original mainnet Chog metadata is never written by this companion system.

## Build and tests

Requirements: root npm dependencies plus Foundry with Solidity 0.8.28.

```sh
npm ci
forge build --root contracts
forge test --root contracts --offline
```

[foundry.toml](foundry.toml) pins the compiler, optimizer and OpenZeppelin remapping. [DemoChog.t.sol](test/DemoChog.t.sol) covers permissionless mint/token URI, owner base-URI update and supply exhaustion. These are targeted tests, not a comprehensive ERC-721/security audit.

## Deployment and owner tooling

[DeployDemoChog.s.sol](script/DeployDemoChog.s.sol) reads `DEPLOY_PRIVATE_KEY`, `DEMO_MAX_SUPPLY` and `DEMO_BASE_URI`. Prepare a new deployment in an isolated reviewed environment and inspect the configured network/signer before broadcast. The historical Node deployment script is account/manifest-pinned and deliberately refuses another deployment in this checkout.

Existing metadata configuration is read-only by default:

```sh
npm run metadata:check
```

An explicit `npm run metadata:check -- --apply` uses `MONAD_OWNER_PRIVATE_KEY`, verifies the existing owner and journals the actual transaction. Preserve uncertain journals and reconcile before retrying. See [deployment.md](../docs/deployment.md).

The source carries an MIT SPDX header. That source-file identifier does not establish a repository-wide license for application code or Chog artwork; see [CONTRIBUTING.md](../CONTRIBUTING.md).
