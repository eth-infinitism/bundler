// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.15;

import "@account-abstraction/contracts/core/EntryPoint.sol";
import "solidity-string-utils/StringUtils.sol";

contract TracerTest {

    uint public a;
    uint public b = 20;
    mapping(address=>uint) public addr2int;

    function testKeccak(bytes memory asd) public payable returns (bytes32 ret) {
        ret = keccak256(asd);
        emit Keccak(ret);
    }

    event Keccak(bytes32 data);

    function revertWithMessage() external {
        revert ("revert message");
    }

    function callWithValue() external payable {
        a = 21;
        this.testKeccak{value : msg.value}("empty");
        addr2int[msg.sender] = b;
    }

    function callRevertingFunction() external payable {
        this.revertWithMessage();
    }
}

