# Demo collection

`DemoChog.sol` is a separate, permissionless-mint demo collection and must never be presented as the original or official Chog collection. It uses the standard OpenZeppelin ERC-721 implementation. The deployer is the owner and may change the collection-wide base URI at any time; token URIs are `<baseURI><decimal tokenId>`. Supply immutable, publicly hosted metadata by policy if that is required for a real demo. The cap and base URI are constructor parameters.

Evolution profile persistence is handled offchain; this contract does not write evolution state onchain. No deployment address, chain ID, RPC, or official collection address is specified here. Verify network settings independently before deployment.
