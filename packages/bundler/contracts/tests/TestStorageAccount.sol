// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.15;

import "@account-abstraction/contracts/interfaces/IAccount.sol";
import "@account-abstraction/contracts/interfaces/IPaymaster.sol";
import "@account-abstraction/contracts/interfaces/IEntryPoint.sol";
import "./TestRuleAccount.sol";
import "./TestCoin.sol";

/**
 * an account with "rules" to trigger different opcode validation rules
 */
contract TestStorageAccount is TestRuleAccount {

    TestCoin public coin;

    function setCoin(TestCoin _coin) public returns (uint){
        coin = _coin;
        return 0;
    }

    event TestMessage(address eventSender);

    function validatePaymasterUserOp(UserOperation calldata userOp, bytes32 userOpHash, uint256 maxCost)
    public virtual override returns (bytes memory context, uint256 deadline) {
        string memory rule = string(userOp.paymasterAndData[20 :]);
        if (eq(rule, 'postOp-context')) {
            return ("some-context", 0);
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
        else if (eq(rule, "read-self")) return uint160(address(coin));
        else if (eq(rule, "allowance-self-1")) return coin.allowance(address(this), address(1));
        else if (eq(rule, "allowance-1-self")) return coin.allowance(address(1), address(this));
        else if (eq(rule, "struct-self")) return coin.getInfo(address(this)).c;
        else if (eq(rule, "struct-1")) return coin.getInfo(address(1)).c;
        else if (eq(rule, "inner-revert")) {
            (bool success,) = address(coin).call(abi.encode(coin.reverting));
            success;
            return 0;
        }
        else if (eq(rule, "oog")) {
            try coin.wasteGas{gas : 10000}() {}
            catch {}
            return 0;
        }
        return super.runRule(rule);
    }
}

contract TestStorageAccountFactory {
    TestCoin public immutable coin;

    constructor(TestCoin _coin) {
        coin = _coin;
    }

    function create(uint salt, string memory rule) public returns (TestStorageAccount) {
        TestStorageAccount a = new TestStorageAccount{salt : bytes32(salt)}();
        a.setCoin(coin);
        a.runRule(rule);
        return a;
    }

}
