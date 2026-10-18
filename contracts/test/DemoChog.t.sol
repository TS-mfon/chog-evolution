// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {DemoChog} from "../src/DemoChog.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";

contract DemoChogTest is IERC721Receiver {
    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }

    function testPermissionlessMintAndMetadata() external {
        DemoChog demo = new DemoChog(2, "ipfs://metadata/");
        uint256 tokenId = demo.mint();
        require(tokenId == 1, "first ID");
        require(demo.ownerOf(tokenId) == address(this), "mint recipient");
        require(keccak256(bytes(demo.tokenURI(tokenId))) == keccak256(bytes("ipfs://metadata/1")), "token URI");
    }

    function testOwnerCanUpdateBaseURI() external {
        DemoChog demo = new DemoChog(1, "ipfs://old/");
        demo.setBaseURI("ipfs://new/");
        demo.mint();
        require(keccak256(bytes(demo.tokenURI(1))) == keccak256(bytes("ipfs://new/1")), "updated URI");
    }

    function testMintStopsAtCap() external {
        DemoChog demo = new DemoChog(1, "ipfs://metadata/");
        demo.mint();
        (bool success,) = address(demo).call(abi.encodeCall(demo.mint, ()));
        require(!success, "mint above cap must revert");
    }
}
