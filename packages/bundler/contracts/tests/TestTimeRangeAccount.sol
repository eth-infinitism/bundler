// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.15;

import "@account-abstraction/contracts/interfaces/IAccount.sol";
import {_packValidationData} from "@account-abstraction/contracts/core/Helpers.sol";

/**
 * test for time-range.
 * simply use maxFeePerGas params as "validUntil"
 */
contract TestTimeRangeAccount is IAccount {

    function validateUserOp(UserOperation calldata userOp, bytes32, uint256)
    external virtual override returns (uint256) {

        return _packValidationData(false, uint48(userOp.maxPriorityFeePerGas), 0);
    }
}

contract TestTimeRangeAccountFactory {
    function create(string memory) public returns (address) {
        return address(new TestTimeRangeAccount{salt: bytes32(uint(0))}());
    }
}
