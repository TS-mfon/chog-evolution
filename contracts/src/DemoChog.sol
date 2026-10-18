// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @notice Separate, clearly labelled test collection for CHOG Evolution.
/// @dev Supply a published metadata URI after rendering; this contract is not the official Chog collection.
contract DemoChog is ERC721, Ownable {
    uint256 public nextTokenId = 1;
    uint256 public immutable maxSupply;
    string private _baseTokenURI;

    error SoldOut();

    constructor(uint256 maxSupply_, string memory baseTokenURI_)
        ERC721("CHOG Evolution Demo", "DCHOG")
        Ownable(msg.sender)
    {
        maxSupply = maxSupply_;
        _baseTokenURI = baseTokenURI_;
    }

    function mint() external returns (uint256 tokenId) {
        tokenId = nextTokenId;
        if (tokenId > maxSupply) revert SoldOut();
        nextTokenId = tokenId + 1;
        _safeMint(msg.sender, tokenId);
    }

    function setBaseURI(string calldata newBaseURI) external onlyOwner {
        _baseTokenURI = newBaseURI;
    }

    function _baseURI() internal view override returns (string memory) {
        return _baseTokenURI;
    }
}
