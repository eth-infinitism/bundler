// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.15;

import "@account-abstraction/contracts/interfaces/IAccount.sol";
import "@account-abstraction/contracts/interfaces/IPaymaster.sol";
import "@account-abstraction/contracts/interfaces/IEntryPoint.sol";
import "@account-abstraction/contracts/core/UserOperationLib.sol";
import "./TestCoin.sol";

contract Dummy {
    uint public value = 1;
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

    function eq(string memory a, string memory b) internal pure returns (bool) {
        return keccak256(bytes(a)) == keccak256(bytes(b));
    }

    event TestFromValidation();
    event TestMessage();

    function execSendMessage() public {
        emit TestMessage();
    }

    function runRule(string memory rule) public returns (uint) {
        if (eq(rule, "")) return 0;
        else if (eq(rule, "number")) return block.number;
        else if (eq(rule, "coinbase")) return uint160(address(block.coinbase));
        else if (eq(rule, "blockhash")) return uint(blockhash(0));
        else if (eq(rule, "create2")) return new Dummy{salt : bytes32(uint(0x1))}().value();
        else if (eq(rule, "balance-self")) return coin.balanceOf(address(this));
        else if (eq(rule, "allowance-self-1")) return coin.allowance(address(this), address(1));
        else if (eq(rule, "allowance-1-self")) return coin.allowance(address(1), address(this));
        else if (eq(rule, "mint-self")) return coin.mint(address(this));
        else if (eq(rule, "balance-1")) return coin.balanceOf(address(1));
        else if (eq(rule, "mint-1")) return coin.mint(address(1));
        else if (eq(rule, "struct-self")) return coin.getInfo(address(this)).c;
        else if (eq(rule, "struct-1")) return coin.getInfo(address(1)).c;

        else if (eq(rule, "inner-revert")) return coin.reverting();
        else if (eq(rule, "emit-msg")) {
            emit TestFromValidation();
            return 0;}

        revert(string.concat("unknown rule: ", rule));
    }

    function addStake(IEntryPoint entryPoint) public payable {
        entryPoint.addStake{value : msg.value}(1);
    }

    function validateUserOp(PackedUserOperation calldata userOp, bytes32, uint256 missingAccountFunds)
    external override returns (uint256) {
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

    function validatePaymasterUserOp(PackedUserOperation calldata userOp, bytes32, uint256)
    external returns (bytes memory context, uint256 deadline) {
        string memory rule = string(userOp.paymasterAndData[UserOperationLib.PAYMASTER_DATA_OFFSET :]);
        runRule(rule);
        return ("", 0);
    }

    function postOp(PostOpMode, bytes calldata, uint256, uint256) external {}

}

contract TestRulesAccountFactory {
    TestCoin public immutable coin = new TestCoin();
    function create(string memory rule) public returns (TestRulesAccount) {
        TestRulesAccount a = new TestRulesAccount{salt : bytes32(uint(0))}();
        a.setCoin(coin);
        a.runRule(rule);
        return a;
    }

}
