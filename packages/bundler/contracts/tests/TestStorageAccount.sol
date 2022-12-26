// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.15;

import "@account-abstraction/contracts/interfaces/IAccount.sol";
import "@account-abstraction/contracts/interfaces/IPaymaster.sol";
import "@account-abstraction/contracts/interfaces/IEntryPoint.sol";
import "./TestRuleAccount.sol";

contract TestCoin {
    mapping(address => uint) balances;

    function balanceOf(address addr) public returns (uint) {
        return balances[addr];
    }

    function mint(address addr) public returns (uint) {
        return balances[addr] += 100;
    }

    //unrelated to token: testing inner object revert
    function reverting() public returns (uint) {
        revert("inner-revert");
    }

    function wasteGas() public returns (uint) {
        while (true) {
            require(msg.sender != ecrecover("message", 27, bytes32(0), bytes32(0)));
        }
        return 0;
    }
}

/**
 * an account with "rules" to trigger different opcode validation rules
 */
contract TestStorageAccount is TestRuleAccount {

    TestCoin coin;

    function setCoin(TestCoin _coin) public returns (uint){
        coin = _coin;
        return 0;
    }

    event TestMessage(address eventSender);

    function validatePaymasterUserOp(UserOperation calldata userOp, bytes32 userOpHash, uint256 maxCost)
    public virtual override returns (bytes memory context, uint256 deadline) {
        string memory rule = string(userOp.paymasterAndData[20 :]);
        if (eq(rule, 'postOp-context')) {
            return ("some-context",0);
        }
//        return ("",0);
        return super.validatePaymasterUserOp(userOp, userOpHash, maxCost);
    }

    function runRule(string memory rule) public virtual override returns (uint) {
        if (eq(rule, "number")) return block.number;
        else if (eq(rule, "balance-self")) return coin.balanceOf(address(this));
        else if (eq(rule, "mint-self")) return coin.mint(address(this));
        else if (eq(rule, "balance-1")) return coin.balanceOf(address(1));
        else if (eq(rule, "mint-1")) return coin.mint(address(1));
        else if (eq(rule, "inner-revert")) {
            (bool success,) = address(coin).call(abi.encode(coin.reverting));
            success;
            return 0;
        }
        else if (eq(rule, "oog")) {
            try coin.wasteGas{gas : 50000}() {}
            catch {}
            return 0;
        }
        return super.runRule(rule);
    }
}

contract TestStorageAccountFactory {
    TestCoin immutable coin;
    constructor() {
        coin = new TestCoin();
    }

    function create(uint salt, string memory rule) public returns (TestStorageAccount) {
        TestStorageAccount a = new TestStorageAccount{salt : bytes32(salt)}();
        a.setCoin(coin);
        a.runRule(rule);
        return a;
    }

}
