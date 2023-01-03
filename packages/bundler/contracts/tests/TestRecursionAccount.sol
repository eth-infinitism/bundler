// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.15;

import "@zerodevapp/contracts/interfaces/IAccount.sol";
import "@zerodevapp/contracts/interfaces/IPaymaster.sol";
import "@zerodevapp/contracts/interfaces/IEntryPoint.sol";
import "./TestRuleAccount.sol";

contract TestRecursionAccount is TestRuleAccount {

    IEntryPoint public immutable ep;
    constructor(IEntryPoint _ep) {
        ep = _ep;
    }

    function runRule(string memory rule) public virtual override returns (uint) {

        if (eq(rule, "handleOps")) {
            UserOperation[] memory ops = new UserOperation[](0);
            ep.handleOps(ops, payable(address (1)));
            return 0;
        }

        return super.runRule(rule);
    }
}
