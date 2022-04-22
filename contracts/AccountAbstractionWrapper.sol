//SPDX-License-Identifier: MIT
pragma solidity ^0.8.7;

import "./account-abstraction/EntryPoint.sol";
import "@openzeppelin/contracts/utils/Address.sol";

contract MevAccountAbstraction {
    using Address for *;

    /**
     * call handleOps, and pay some proceeds to coinbase.
     * the rest of the handleOp proceeds are sent back to the owner.
     * The transaction will revert if handleOp doesn't send enough to cover the payment to
     * coinbase.
     * @param payCoinbase - amount to pay coinbase
     */
    function handleOps(EntryPoint entryPoint, UserOperation[] calldata ops, uint payCoinbase) external {
        entryPoint.handleOps(ops, payable(address(this)));
        payable(block.coinbase).sendValue(payCoinbase);
        payable(msg.sender).sendValue(address(this).balance - payCoinbase);
    }

    /**
     * helper method: test if the given userOp pays enough.
     * should be executed in view mode.
     * @returns paid - the amount paid to beneficiary
     * @return s 
     */
    function estimateHandleOps(EntryPoint entryPoint, UserOperation[] calldata ops, uint payCoinbase) external returns(uint using paid, uint gasPrice) {
	    uint bal = address(this).balance;
        entryPoint.handleOps(ops, payable(address(this)));
	uint paid = address(this).balance - bal;
        payable(block.coinbase).sendValue(payCoinbase);
        payable(msg.sender).sendValue(address(this).balance - payCoinbase);
    }
}
