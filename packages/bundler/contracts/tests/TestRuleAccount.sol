// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.15;

import "@account-abstraction/contracts/interfaces/IAccount.sol";
import "@account-abstraction/contracts/interfaces/IPaymaster.sol";
import "@account-abstraction/contracts/interfaces/IEntryPoint.sol";

/**
 * contract for testing account interaction.
 * doesn't really do validation: the signature is a "rule" to define the validation action to take.
 * as a paymaster, the paymasterAndData is the "rule" to take (at offset 20, just after the paymaster address)
 * the account also as a "state" variable and event, so we can use it to test state transitions
 */
contract TestRuleAccount is IAccount, IPaymaster {

    uint state;

    event State(uint oldState, uint newState);

    function setState(uint _state) external {
        emit State(state, _state);
        state = _state;
    }

    function eq(string memory a, string memory b) internal returns (bool) {
        return keccak256(bytes(a)) == keccak256(bytes(b));
    }

    /**
     * "rules" to test. override to add more "rules"
     * the return value is used as "deadline".
     */
    function runRule(string memory rule) public virtual returns (uint) {
        if (eq(rule, "")) return 0;
        else if (eq(rule, "ok")) return 0;
        else if (eq(rule, "fail")) revert("fail rule");
        else
            revert(string.concat("unknown rule: ", rule));
    }

    //needed in order to make it a valid paymaster
    function addStake(IEntryPoint entryPoint) public payable {
        entryPoint.addStake{value : msg.value}(1);
    }

    function validateUserOp(UserOperation calldata userOp, bytes32, address, uint256 missingAccountFunds)
    external override returns (uint256) {
        if (missingAccountFunds > 0) {
            /* solhint-disable-next-line avoid-low-level-calls */
            (bool success,) = msg.sender.call{value : missingAccountFunds}("");
            success;
        }
        return runRule(string(userOp.signature));
    }

    function validatePaymasterUserOp(UserOperation calldata userOp, bytes32 userOpHash, uint256 maxCost)
    external returns (bytes memory context, uint256 deadline) {
        string memory rule = string(userOp.paymasterAndData[20 :]);
        return ("", runRule(rule));
    }

    function postOp(PostOpMode, bytes calldata, uint256) external {}
}

contract TestAccountDeployer {
    function create(string memory rule) public returns (TestRuleAccount) {
        TestRuleAccount a = new TestRuleAccount{salt : bytes32(uint(0))}();
        a.runRule(rule);
        return a;
    }
}
