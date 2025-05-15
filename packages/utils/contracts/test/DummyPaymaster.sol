pragma solidity ^0.8.0;
//SPDX-License-Identifier: GPL-3.0-only

import "@account-abstraction/contracts/core/BasePaymaster.sol";
// dummy erc-4337 paymaster
// ignores validation, and pays for everything. just for testing handleOps

contract DummyPaymaster is BasePaymaster {

    constructor(IEntryPoint _entryPoint) BasePaymaster(_entryPoint) {}

    function _validatePaymasterUserOp(PackedUserOperation calldata, bytes32, uint256)
    internal pure override returns (bytes memory, uint256) {
        return ("", 0);
    }
}
