// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {DemoChog} from "../src/DemoChog.sol";

interface VmDeploy {
    function envUint(string calldata name) external returns (uint256 value);
    function envString(string calldata name) external returns (string memory value);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

/// @notice Deploy the explicitly-labelled demo collection to Monad testnet.
/// @dev The signer is supplied via DEPLOY_PRIVATE_KEY in the process environment.
contract DeployDemoChog {
    VmDeploy private constant vm =
        VmDeploy(address(uint160(uint256(keccak256("hevm cheat code")))));

    function run() external returns (DemoChog deployed) {
        uint256 privateKey = vm.envUint("DEPLOY_PRIVATE_KEY");
        uint256 maxSupply = vm.envUint("DEMO_MAX_SUPPLY");
        string memory baseURI = vm.envString("DEMO_BASE_URI");

        vm.startBroadcast(privateKey);
        deployed = new DemoChog(maxSupply, baseURI);
        vm.stopBroadcast();
    }
}
