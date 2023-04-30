// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.15;

import "@account-abstraction/contracts/interfaces/IAccount.sol";
import "@account-abstraction/contracts/interfaces/IPaymaster.sol";
import "@account-abstraction/contracts/interfaces/IEntryPoint.sol";
import "./TestRuleAccount.sol";

contract Dummy {
}


/**
 * an account with "rules" to trigger different opcode validation rules
 */
contract TestOpcodesAccount is TestRuleAccount {

    event TestMessage(address eventSender);
    event ExecutionMessage();

    function runRule(string memory rule) public virtual override returns (uint) {
        if (eq(rule, "number")) return block.number;
        else if (eq(rule, "coinbase")) return uint160(address(block.coinbase));
        else if (eq(rule, "blockhash")) return uint(blockhash(0));
        else if (eq(rule, "create2")) {
            new Dummy{salt : bytes32(uint(0x1))}();
            return 0;
        }
        else if (eq(rule, "emit-msg")) {
            emit TestMessage(address(this));
            return 0;
        }
        return super.runRule(rule);
    }

    function execEvent() public {
        emit ExecutionMessage();
    }
}

contract TestOpcodesAccountFactory {
    function create(string memory rule) public returns (TestOpcodesAccount) {
        TestOpcodesAccount a = new TestOpcodesAccount{salt : bytes32(uint(0))}();
        a.runRule(rule);
        return a;
    }

}
