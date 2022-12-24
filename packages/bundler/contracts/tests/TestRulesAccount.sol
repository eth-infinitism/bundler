// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.15;

import "@account-abstraction/contracts/interfaces/IAccount.sol";
import "@account-abstraction/contracts/interfaces/IPaymaster.sol";
import "@account-abstraction/contracts/interfaces/IEntryPoint.sol";

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

contract TestRulesAccount is IAccount, IPaymaster {

    uint state;
    TestCoin public coin;

    event State(uint oldState, uint newState);

    function setState(uint _state) external {
        emit State(state, _state);
        state = _state;
    }

    function setCoin(TestCoin _coin) public returns (uint){
        coin = _coin;
        return 0;
    }

    function eq(string memory a, string memory b) internal returns (bool) {
        return keccak256(bytes(a)) == keccak256(bytes(b));
    }

    event TestMessage(address eventSender);

    function runRule(string memory rule) public returns (uint) {
        if (eq(rule, "")) return 0;
        else if (eq(rule, "number")) return block.number;
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

        revert(string.concat("unknown rule: ", rule));
    }

    function addStake(IEntryPoint entryPoint) public payable {
        entryPoint.addStake{value : msg.value}(1);
    }

    function validateUserOp(UserOperation calldata userOp, bytes32, address, uint256 missingAccountFunds)
    external override returns (uint256 ) {
        if (missingAccountFunds > 0) {
            /* solhint-disable-next-line avoid-low-level-calls */
            (bool success,) = msg.sender.call{value : missingAccountFunds}("");
            success;
        }
        if (userOp.signature.length == 4) {
            uint32 deadline = uint32(bytes4(userOp.signature));
            return deadline;
        }
        runRule(string(userOp.signature));
        return 0;
    }

    function validatePaymasterUserOp(UserOperation calldata userOp, bytes32 userOpHash, uint256 maxCost)
    external returns (bytes memory context, uint256 deadline) {
        string memory rule = string(userOp.paymasterAndData[20 :]);
        runRule(rule);
        return ("", 0);
    }

    function postOp(PostOpMode, bytes calldata, uint256) external {}

}

contract TestRulesAccountDeployer {
    function create(string memory rule, TestCoin coin) public returns (TestRulesAccount) {
        TestRulesAccount a = new TestRulesAccount{salt : bytes32(uint(0))}();
        a.setCoin(coin);
        a.runRule(rule);
        return a;
    }

}
