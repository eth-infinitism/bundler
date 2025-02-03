// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.15;

import "@account-abstraction/contracts/interfaces/IAccount.sol";
import "@account-abstraction/contracts/interfaces/IPaymaster.sol";
import "@account-abstraction/contracts/interfaces/IEntryPoint.sol";
import "./TestRuleAccount.sol";

contract TestRecursionAccount is TestRuleAccount {

    IEntryPoint public immutable ep;
    constructor(IEntryPoint _ep) {
        ep = _ep;
    }

    function runRule(string memory rule) public virtual override returns (uint) {

        if (eq(rule, "handleOps")) {
            //handleOps is protected by reentrancy guard. check other blocked calls to EntryPoint
            ep.getDepositInfo(address(0));
            return 0;
        }

        return super.runRule(rule);
    }
}
