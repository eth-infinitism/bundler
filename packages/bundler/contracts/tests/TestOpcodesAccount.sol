// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.15;

import "@account-abstraction/contracts/interfaces/IAccount.sol";
import "@account-abstraction/contracts/interfaces/IPaymaster.sol";
import "@account-abstraction/contracts/interfaces/IEntryPoint.sol";
import "./TestRuleAccount.sol";

contract Dummy {
    uint public value = 1;
}

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
        string memory buffer = "string to be duplicated";
        while (true) {
            buffer = string.concat(buffer, buffer);
        }
        return 0;
    }
}

/**
 * an account with "rules" to trigger different opcode validation rules
 */
contract TestOpcodesAccount is TestRuleAccount {

    TestCoin coin;

    function setCoin(TestCoin _coin) public returns (uint){
        coin = _coin;
        return 0;
    }

    event TestMessage(address eventSender);

    function runRule(string memory rule) public virtual override returns (uint) {
        if (eq(rule, "number")) return block.number;
        else if (eq(rule, "coinbase")) return uint160(address(block.coinbase));
        else if (eq(rule, "blockhash")) return uint(blockhash(0));
        else if (eq(rule, "create2")) return new Dummy{salt : bytes32(uint(0x1))}().value();
        else if (eq(rule, "balance-self")) return coin.balanceOf(address(this));
        else if (eq(rule, "mint-self")) return coin.mint(address(this));
        else if (eq(rule, "balance-1")) return coin.balanceOf(address(1));
        else if (eq(rule, "mint-1")) return coin.mint(address(1));

        else if (eq(rule, "inner-revert")) return coin.reverting();
        else if (eq(rule, "oog")) return coin.wasteGas();
        else if (eq(rule, "emit-msg")) {
            emit TestMessage(address(this));
            return 0;}

        return super.runRule(rule);
    }
}

contract TestOpcodesAccountDeployer {
    function create(string memory rule) public returns (TestOpcodesAccount) {
        TestOpcodesAccount a = new TestOpcodesAccount{salt : bytes32(uint(0))}();
//        a.setCoin(coin);
        a.runRule(rule);
        return a;
    }

}
