// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.15;

import "@account-abstraction/contracts/interfaces/IAccount.sol";
import {_packValidationData} from "@account-abstraction/contracts/core/Helpers.sol";
import "@account-abstraction/contracts/core/UserOperationLib.sol";

/**
 * test for time-range.
 * - use maxPriorityFeePerGas params as "validUntil"
 * - use preVerificationGas as "validFrom"
 */
contract TestTimeRangeAccount is IAccount {

    using UserOperationLib for PackedUserOperation;

    function validateUserOp(PackedUserOperation calldata userOp, bytes32, uint256)
    external virtual override returns (uint256) {

        uint48 validAfter = uint48(userOp.preVerificationGas);
        uint48 validUntil =  uint48(userOp.unpackMaxPriorityFeePerGas());
        return _packValidationData(false, validUntil, validAfter);
    }
}

contract TestTimeRangeAccountFactory {
    function create(string memory) public returns (address) {
        return address(new TestTimeRangeAccount{salt: bytes32(uint(0))}());
    }
}
